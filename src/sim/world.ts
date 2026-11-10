import type { Cell } from '../../shared/types';

export const COLS = 19;
export const ROWS = 13;
/** Rack rows. Rows above and below are open cross-aisles. */
export const RACK_TOP = 2;
export const RACK_BOTTOM = 10;

export interface Station {
  name: string;
  cell: Cell;
  kind: 'dock' | 'base' | 'quarantine';
}

export const key = (c: Cell) => `${c.x},${c.y}`;
export const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

export class World {
  readonly obstacles = new Set<string>();
  readonly stations: Station[] = [
    { name: 'Base', cell: { x: 0, y: 0 }, kind: 'base' },
    { name: 'Quarantine', cell: { x: 18, y: 0 }, kind: 'quarantine' },
    { name: 'Dock A', cell: { x: 3, y: 12 }, kind: 'dock' },
    { name: 'Dock B', cell: { x: 9, y: 12 }, kind: 'dock' },
    { name: 'Dock C', cell: { x: 15, y: 12 }, kind: 'dock' },
  ];

  get base(): Station {
    return this.stations[0];
  }
  get quarantine(): Station {
    return this.stations[1];
  }
  get docks(): Station[] {
    return this.stations.filter((s) => s.kind === 'dock');
  }

  inBounds(c: Cell): boolean {
    return c.x >= 0 && c.y >= 0 && c.x < COLS && c.y < ROWS;
  }

  /** Aisles are the single-cell columns at x = 0, 3, 6 ... between two-cell-wide racks. */
  isRack(c: Cell): boolean {
    return c.y >= RACK_TOP && c.y <= RACK_BOTTOM && c.x % 3 !== 0;
  }

  /** True for a cell inside a narrow aisle (between racks). */
  inAisle(c: Cell): boolean {
    return c.y >= RACK_TOP && c.y <= RACK_BOTTOM && c.x % 3 === 0;
  }

  aisleNumber(c: Cell): number {
    return c.x / 3 + 1;
  }

  stationAt(c: Cell): Station | undefined {
    return this.stations.find((s) => same(s.cell, c));
  }

  hasObstacle(c: Cell): boolean {
    return this.obstacles.has(key(c));
  }

  isBlocked(c: Cell, ignoreObstacles = false): boolean {
    if (!this.inBounds(c) || this.isRack(c)) return true;
    return !ignoreObstacles && this.hasObstacle(c);
  }

  describe(c: Cell): string {
    const station = this.stationAt(c);
    if (station) return station.name;
    if (this.inAisle(c)) return `aisle ${this.aisleNumber(c)}`;
    return c.y < RACK_TOP ? 'the north cross-aisle' : 'the south cross-aisle';
  }
}
