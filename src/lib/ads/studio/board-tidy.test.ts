import { describe, expect, it } from 'vitest';
import type { BoardFrame } from './board-shape';
import { tidyLayout } from './board-tidy';

const f = (id: string, format: BoardFrame['format'], y: number, group?: string): Pick<BoardFrame, 'id' | 'x' | 'y' | 'format' | 'group' | 'doc'> =>
  ({ id, x: 0, y, format, group, doc: null });

describe('tidyLayout', () => {
  // A shoot board as built: one ad a row (its 4:5, 9:16 and 3:4), twelve rows down.
  const tall = Array.from({ length: 12 }, (_, i) => [f(`a${i}p`, 'portrait', i * 500, `g${i}`), f(`a${i}s`, 'story', i * 500, `g${i}`), f(`a${i}g`, 'r3x4', i * 500, `g${i}`)]).flat();

  it('keeps each ad’s sizes side by side, in order, on one row', () => {
    const out = tidyLayout(tall, 1.6);
    for (let i = 0; i < 12; i++) {
      const [p, s, g] = [`a${i}p`, `a${i}s`, `a${i}g`].map(id => out.get(id)!);
      expect(p.y).toBe(s.y); expect(s.y).toBe(g.y);
      expect(p.x).toBeLessThan(s.x); expect(s.x).toBeLessThan(g.x);
    }
  });

  it('puts several ads a row on a wide board, so it is no longer one tall column', () => {
    const out = tidyLayout(tall, 1.6);
    const rows = new Set([...out.values()].map(p => p.y)).size;
    expect(rows).toBeGreaterThan(1);
    expect(rows).toBeLessThan(12);
  });

  it('keeps the reading order: the first ad first', () => {
    const out = tidyLayout(tall, 1.6);
    expect(out.get('a0p')).toEqual({ x: 0, y: 0 });
    expect(out.get('a1p')!.y === 0 ? out.get('a1p')!.x : out.get('a1p')!.y).toBeGreaterThan(0);
  });

  it('designs without sizes are each their own', () => {
    const out = tidyLayout([f('x', 'portrait', 0), f('y', 'portrait', 0), f('z', 'story', 900)], 2);
    expect(out.size).toBe(3);
  });
});
