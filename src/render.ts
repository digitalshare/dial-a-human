import type { Cell } from '../shared/types';
import type { Sim } from './sim/robot';
import { COLS, ROWS, RACK_BOTTOM, RACK_TOP } from './sim/world';

export const CELL = 46;
export const WIDTH = COLS * CELL;
export const HEIGHT = ROWS * CELL;

const STATE_COLOR: Record<string, string> = {
  idle: '#8b98a8',
  to_pick: '#2dd4bf',
  to_drop: '#2dd4bf',
  returning: '#60a5fa',
  awaiting_human: '#f87171',
  waiting_clear: '#fbbf24',
  parked: '#fbbf24',
};

const STATION_COLOR = { dock: '#1f6f54', base: '#1e4a7a', quarantine: '#6b3a6f' } as const;

export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  canvas.style.aspectRatio = `${WIDTH} / ${HEIGHT}`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  return ctx;
}

/** Convert a mouse event to a grid cell, allowing for CSS scaling of the canvas. */
export function cellFromEvent(canvas: HTMLCanvasElement, e: MouseEvent): Cell {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - rect.left) / rect.width) * COLS),
    y: Math.floor(((e.clientY - rect.top) / rect.height) * ROWS),
  };
}

const cx = (v: number) => v * CELL + CELL / 2;

export function draw(ctx: CanvasRenderingContext2D, sim: Sim, now: number): void {
  const w = sim.world;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#1a1f27';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // floor grid
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) line(ctx, x * CELL, 0, x * CELL, HEIGHT);
  for (let y = 0; y <= ROWS; y++) line(ctx, 0, y * CELL, WIDTH, y * CELL);

  // racks
  for (let x = 0; x < COLS; x++) {
    for (let y = RACK_TOP; y <= RACK_BOTTOM; y++) {
      if (!w.isRack({ x, y })) continue;
      ctx.fillStyle = '#323c4d';
      ctx.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = '#414d62';
      ctx.fillRect(x * CELL + 7, y * CELL + 9, CELL - 14, 6);
      ctx.fillRect(x * CELL + 7, y * CELL + CELL - 15, CELL - 14, 6);
    }
  }

  // aisle numbers
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  for (let x = 0; x < COLS; x += 3) ctx.fillText(`AISLE ${x / 3 + 1}`, cx(x), CELL * 1.5);

  // stations
  for (const s of w.stations) {
    ctx.fillStyle = STATION_COLOR[s.kind];
    round(ctx, s.cell.x * CELL + 3, s.cell.y * CELL + 3, CELL - 6, CELL - 6, 7);
    ctx.fill();
    ctx.fillStyle = '#e6edf3';
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    const label = s.kind === 'quarantine' ? 'QUAR.' : s.name.toUpperCase();
    ctx.fillText(label, cx(s.cell.x), cx(s.cell.y));
  }

  // obstacles
  for (const k of w.obstacles) {
    const [x, y] = k.split(',').map(Number);
    const px = x * CELL + 6;
    const py = y * CELL + 6;
    const size = CELL - 12;
    ctx.fillStyle = '#c2702a';
    round(ctx, px, py, size, size, 4);
    ctx.fill();
    ctx.strokeStyle = '#3b2410';
    ctx.lineWidth = 2;
    line(ctx, px + 4, py + 4, px + size - 4, py + size - 4);
    line(ctx, px + size - 4, py + 4, px + 4, py + size - 4);
    ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
  }

  // pickup marker
  if (sim.job && sim.state === 'to_pick') {
    const p = sim.job.pick;
    ctx.fillStyle = sim.job.unlabelled ? '#f87171' : '#e2c08d';
    round(ctx, cx(p.x) - 8, cx(p.y) - 8, 16, 16, 3);
    ctx.fill();
  }

  // planned path
  if (sim.path.length && sim.state !== 'awaiting_human' && sim.state !== 'parked') {
    ctx.strokeStyle = 'rgba(45,212,191,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(cx(sim.pos.x), cx(sim.pos.y));
    for (const c of sim.path) ctx.lineTo(cx(c.x), cx(c.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawRobot(ctx, sim, now);
  drawBubble(ctx, sim, now);
}

function drawRobot(ctx: CanvasRenderingContext2D, sim: Sim, now: number): void {
  const x = cx(sim.pos.x);
  const y = cx(sim.pos.y);
  const color = STATE_COLOR[sim.state] ?? '#2dd4bf';

  if (sim.state === 'awaiting_human' || sim.state === 'parked') {
    const t = (now % 1400) / 1400;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 16 + t * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sim.heading);
  ctx.fillStyle = '#0e1116';
  round(ctx, -17, -15, 34, 30, 8);
  ctx.fill();
  ctx.fillStyle = color;
  round(ctx, -15, -13, 30, 26, 7);
  ctx.fill();
  ctx.fillStyle = '#0e1116';
  ctx.beginPath(); // nose, shows heading
  ctx.moveTo(13, 0);
  ctx.lineTo(5, -6);
  ctx.lineTo(5, 6);
  ctx.closePath();
  ctx.fill();
  if (sim.carrying) {
    ctx.fillStyle = '#e2c08d';
    round(ctx, -11, -7, 14, 14, 2);
    ctx.fill();
    ctx.strokeStyle = '#7a5a2b';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-11, -7, 14, 14);
  }
  ctx.restore();
}

function drawBubble(ctx: CanvasRenderingContext2D, sim: Sim, now: number): void {
  const bubble = sim.bubble;
  if (!bubble || now > bubble.until) return;
  ctx.font = '500 12px ui-sans-serif, system-ui, sans-serif';
  const lines = wrap(ctx, bubble.text, 230).slice(0, 3);
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
  const height = lines.length * 16 + 12;
  let bx = cx(sim.pos.x) - width / 2;
  let by = cx(sim.pos.y) - 30 - height;
  bx = Math.min(Math.max(bx, 4), WIDTH - width - 4);
  if (by < 4) by = cx(sim.pos.y) + 30;
  ctx.fillStyle = 'rgba(230,237,243,0.96)';
  round(ctx, bx, by, width, height, 8);
  ctx.fill();
  ctx.fillStyle = '#0e1116';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 9, by + 7 + i * 16));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(next).width > maxWidth) {
      out.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function round(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
