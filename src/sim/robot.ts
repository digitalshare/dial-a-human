import type { Cell, Incident, RobotCommand } from '../../shared/types';
import { blockedIncident, unlabelledIncident } from './incidents';
import { findPath } from './pathfinding';
import { COLS, RACK_BOTTOM, RACK_TOP, key, same, World, type Station } from './world';

export type MovingState = 'to_pick' | 'to_drop' | 'returning';
export type RobotState =
  | 'idle'
  | MovingState
  | 'awaiting_human'
  | 'waiting_clear'
  | 'parked';

export interface Job {
  packageId: string;
  pick: Cell;
  dropAt: Station;
  unlabelled: boolean;
}

const SPEED = 3.2; // cells per second
/** A detour up to this many extra cells is the robot's own call; beyond it, a human decides. */
const DETOUR_LIMIT = 4;
const LOOKAHEAD = 3;

/** "PKG-101" reads badly in text-to-speech; say "package 101" on the phone instead. */
const spoken = (packageId?: string) => (packageId ? `package ${packageId.replace(/^PKG-/, '')}` : 'a package');

export class Sim {
  readonly robotId = 'R-7';
  readonly world = new World();

  cell: Cell = { ...this.world.base.cell };
  pos = { x: this.cell.x, y: this.cell.y };
  heading = Math.PI / 2;
  path: Cell[] = [];
  goal: Cell | null = null;
  state: RobotState = 'idle';
  job: Job | null = null;
  carrying = false;
  incident: Incident | null = null;
  delivered = 0;
  battery = 87;
  spillArmed = false;
  unlabelledArmed = false;
  /** Latest thing the robot said on the call, drawn as a speech bubble. */
  bubble: { text: string; until: number } | null = null;

  onIncident: (incident: Incident) => void = () => {};
  onLog: (text: string, tone?: 'info' | 'warn' | 'good') => void = () => {};

  private resumeState: MovingState = 'to_pick';
  private progress = 0;
  private timer = 1;
  private packageSeq = 100;

  update(dt: number): void {
    this.battery = Math.max(5, this.battery - dt * 0.01);
    switch (this.state) {
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) this.startNextJob();
        break;
      case 'to_pick':
      case 'to_drop':
      case 'returning':
        this.move(dt);
        break;
      case 'waiting_clear':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = 0.5;
          this.checkCleared();
        }
        break;
      case 'awaiting_human':
      case 'parked':
        break;
    }
  }

  // ---- presenter controls -------------------------------------------------

  /** Toggle an obstacle on a floor cell. Returns false when the cell cannot take one. */
  toggleObstacle(c: Cell): boolean {
    const w = this.world;
    if (w.hasObstacle(c)) {
      w.obstacles.delete(key(c));
      return true;
    }
    if (w.isBlocked(c) || w.stationAt(c)) return false;
    if (same(c, this.cell) || (this.path[0] && same(c, this.path[0]))) return false;
    w.obstacles.add(key(c));
    return true;
  }

  clearObstacles(): void {
    this.world.obstacles.clear();
  }

  armUnlabelled(): void {
    if (this.job && this.state === 'to_pick') {
      this.job.unlabelled = true;
      this.onLog(`Presenter: package ${this.job.packageId} has lost its label.`, 'warn');
    } else {
      this.unlabelledArmed = true;
      this.onLog('Presenter: the next package will have no label.', 'warn');
    }
  }

  // ---- operator commands --------------------------------------------------

  /** Apply the human's decision. Returns false if there was nothing to decide. */
  applyCommand(cmd: RobotCommand): boolean {
    const incident = this.incident;
    if (!incident || (this.state !== 'awaiting_human' && this.state !== 'parked')) return false;
    this.incident = null;
    const w = this.world;

    switch (cmd.action) {
      case 'reroute':
        this.planTo(this.goal ?? w.base.cell, this.resumeState);
        break;
      case 'wait':
        this.state = 'waiting_clear';
        this.timer = 0.5;
        break;
      case 'skip_job':
        this.job = null;
        this.carrying = false;
        this.path = [];
        this.state = 'idle';
        this.timer = 0.5;
        break;
      case 'return_to_base':
        this.planTo(w.base.cell, 'returning');
        break;
      case 'deliver_to': {
        const wanted = (cmd.target ?? '').toLowerCase();
        const dock = w.docks.find((d) => d.name.toLowerCase() === wanted) ?? w.docks[0];
        if (this.job) {
          this.job.dropAt = dock;
          this.job.unlabelled = false;
        }
        this.planTo(dock.cell, 'to_drop');
        break;
      }
      case 'set_aside':
        if (this.job) {
          this.job.dropAt = w.quarantine;
          this.job.unlabelled = false;
        }
        this.planTo(w.quarantine.cell, 'to_drop');
        break;
    }
    return true;
  }

  /** The call ended and nobody told the robot what to do. */
  park(): void {
    if (this.state === 'awaiting_human') {
      this.state = 'parked';
      this.onLog('No instruction received. Parked safely and waiting.', 'warn');
    }
  }

  /** Try the call again for the incident the robot is parked on. */
  retryCall(): void {
    if (this.state === 'parked' && this.incident) {
      this.state = 'awaiting_human';
      this.onIncident(this.incident);
    }
  }

  say(text: string): void {
    this.bubble = { text, until: performance.now() + 6000 };
  }

  statusText(): string {
    const where = this.world.describe(this.cell);
    const doing: Record<RobotState, string> = {
      idle: 'idle and ready for the next job',
      to_pick: `heading to pick up ${spoken(this.job?.packageId)}`,
      to_drop: `carrying ${spoken(this.job?.packageId)} to ${this.job?.dropAt.name ?? 'its destination'}`,
      returning: 'returning to base',
      awaiting_human: 'stopped and waiting for an operator decision',
      waiting_clear: 'holding position until the path is clear',
      parked: 'parked safely, waiting for an operator',
    };
    return `Robot ${this.robotId} is ${doing[this.state]}, currently in ${where}. Battery is at ${Math.round(this.battery)} percent. It has delivered ${this.delivered} packages this shift.`;
  }

  // ---- internals ----------------------------------------------------------

  private startNextJob(): void {
    const w = this.world;
    const docks = w.docks;
    const aisle = Math.floor(Math.random() * Math.ceil(COLS / 3));
    const pick: Cell = {
      x: aisle * 3,
      y: RACK_TOP + Math.floor(Math.random() * (RACK_BOTTOM - RACK_TOP + 1)),
    };
    this.job = {
      packageId: `PKG-${++this.packageSeq}`,
      pick,
      dropAt: docks[Math.floor(Math.random() * docks.length)],
      unlabelled: this.unlabelledArmed,
    };
    this.unlabelledArmed = false;
    this.carrying = false;
    this.onLog(
      `New job: ${this.job.packageId} from ${w.describe(pick)} to ${this.job.dropAt.name}.`,
    );
    this.planTo(pick, 'to_pick');
  }

  /** Head for a goal. If there is no route at all, ask a human. */
  private planTo(goal: Cell, state: MovingState): void {
    this.goal = goal;
    this.progress = 0;
    const p = findPath(this.world, this.cell, goal);
    if (!p) {
      this.resumeState = state;
      this.raiseBlocked(goal, null);
      return;
    }
    this.path = p;
    this.state = state;
  }

  private move(dt: number): void {
    if (this.path.length === 0) {
      this.arrive();
      return;
    }
    if (this.progress === 0) {
      if (this.spillArmed) this.trySpill();
      const n = Math.min(LOOKAHEAD, this.path.length);
      for (let i = 0; i < n; i++) {
        if (this.world.isBlocked(this.path[i])) {
          this.handleBlocked(this.path[i]);
          return;
        }
      }
    }
    const next = this.path[0];
    this.heading = Math.atan2(next.y - this.cell.y, next.x - this.cell.x);
    this.progress += SPEED * dt;
    if (this.progress >= 1) {
      this.cell = next;
      this.path.shift();
      this.progress = 0;
      this.pos = { x: next.x, y: next.y };
    } else {
      this.pos = {
        x: this.cell.x + (next.x - this.cell.x) * this.progress,
        y: this.cell.y + (next.y - this.cell.y) * this.progress,
      };
    }
  }

  private arrive(): void {
    const w = this.world;
    const job = this.job;
    switch (this.state) {
      case 'to_pick':
        if (!job) break;
        this.carrying = true;
        if (job.unlabelled) {
          this.resumeState = 'to_drop';
          this.state = 'awaiting_human';
          this.onLog(`Picked up ${job.packageId} but it has no label.`, 'warn');
          this.raise(
            unlabelledIncident({
              robotId: this.robotId,
              where: w.describe(this.cell),
              packageId: spoken(job.packageId),
              docks: w.docks.map((d) => d.name),
            }),
          );
          return;
        }
        this.onLog(`Picked up ${job.packageId}.`);
        this.planTo(job.dropAt.cell, 'to_drop');
        return;
      case 'to_drop':
        this.delivered++;
        this.onLog(`Delivered ${job?.packageId ?? 'package'} to ${job?.dropAt.name ?? 'dock'}.`, 'good');
        break;
      case 'returning':
        this.onLog('Back at base.', 'good');
        break;
    }
    this.job = null;
    this.carrying = false;
    this.goal = null;
    this.state = 'idle';
    this.timer = 1;
  }

  /** Something is in the way within sensor range. Small detours are the robot's own call. */
  private handleBlocked(blocked: Cell): void {
    if (!this.goal) return;
    const alt = findPath(this.world, this.cell, this.goal);
    if (alt && alt.length - this.path.length <= DETOUR_LIMIT) {
      const extra = alt.length - this.path.length;
      this.path = alt;
      this.onLog(`Obstacle in ${this.world.describe(blocked)}. Rerouted on my own (+${extra} m).`);
      return;
    }
    this.resumeState = this.state as MovingState;
    this.raiseBlocked(blocked, alt);
  }

  private raiseBlocked(blocked: Cell, alt: Cell[] | null): void {
    const w = this.world;
    const baseline =
      this.path.length || findPath(w, this.cell, this.goal ?? blocked, true)?.length || 0;
    const extra = alt ? Math.max(1, alt.length - baseline) : null;
    this.state = 'awaiting_human';
    this.onLog(`Blocked in ${w.describe(blocked)}. This one needs a human decision.`, 'warn');
    this.raise(
      blockedIncident({
        robotId: this.robotId,
        where: w.describe(blocked),
        destination: this.goal ? this.goalName(this.goal) : 'my destination',
        extraCells: extra,
        carrying: this.carrying,
      }),
    );
  }

  private raise(incident: Incident): void {
    this.incident = incident;
    this.onIncident(incident);
  }

  private goalName(goal: Cell): string {
    const station = this.world.stationAt(goal);
    if (station) return station.name;
    return `the pickup in ${this.world.describe(goal)}`;
  }

  /** While waiting: resume once a route no worse than a small detour exists again. */
  private checkCleared(): void {
    if (!this.goal) return;
    const ideal = findPath(this.world, this.cell, this.goal, true);
    const now = findPath(this.world, this.cell, this.goal);
    if (ideal && now && now.length - ideal.length <= DETOUR_LIMIT) {
      this.path = now;
      this.progress = 0;
      this.state = this.resumeState;
      this.onLog('Path is clear again. Carrying on.', 'good');
    }
  }

  /**
   * Presenter's "spill a pallet" trick: drop it two cells ahead once the robot is deep
   * enough in a narrow aisle that backing out is a long detour, so the call is guaranteed.
   */
  private trySpill(): void {
    const w = this.world;
    if (this.path.length < 4 || !w.inAisle(this.cell)) return;
    const ahead = this.path.slice(0, 3);
    if (!ahead.every((c) => c.x === this.cell.x && w.inAisle(c))) return;
    const goingDown = ahead[0].y > this.cell.y;
    const depth = goingDown ? this.cell.y - (RACK_TOP - 1) : RACK_BOTTOM + 1 - this.cell.y;
    if (depth < 3) return;
    w.obstacles.add(key(ahead[2]));
    this.spillArmed = false;
    this.onLog(`Presenter: a pallet has spilled in ${w.describe(ahead[2])}.`, 'warn');
  }
}
