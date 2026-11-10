import type { Cell } from '../../shared/types';
import { key, same, type World } from './world';

const DIRS: Cell[] = [
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
];

/**
 * Shortest 4-connected path on the grid (uniform cost, so breadth-first is optimal).
 * Returns the cells after `from` up to and including `to`, or null when unreachable.
 */
export function findPath(
  world: World,
  from: Cell,
  to: Cell,
  ignoreObstacles = false,
): Cell[] | null {
  if (same(from, to)) return [];
  if (world.isBlocked(to, ignoreObstacles)) return null;

  const prev = new Map<string, Cell>();
  const seen = new Set<string>([key(from)]);
  const queue: Cell[] = [from];

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const d of DIRS) {
      const next = { x: cur.x + d.x, y: cur.y + d.y };
      const k = key(next);
      if (seen.has(k) || world.isBlocked(next, ignoreObstacles)) continue;
      seen.add(k);
      prev.set(k, cur);
      if (same(next, to)) {
        const path: Cell[] = [next];
        let step = cur;
        while (!same(step, from)) {
          path.push(step);
          step = prev.get(key(step))!;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}
