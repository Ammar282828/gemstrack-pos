/**
 * Tidy up a board (2026-10-16). Pure; the page's Tidy button and scripts use it. Tested.
 */

import { BOARD_SCALE, framePx, type BoardFrame } from './board-shape';

/**
 * Where Tidy puts each design: ads (a design with its other sizes, `group`) in reading order, each ad's sizes in
 * one block, as many blocks a row as make the whole about the board's shape (`aspect`, width over height).
 */
export function tidyLayout(frames: Pick<BoardFrame, 'id' | 'x' | 'y' | 'format' | 'group' | 'doc'>[], aspect: number): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (!frames.length) return out;
  const order = [...frames].sort((a, b) => Math.round(a.y / 160) - Math.round(b.y / 160) || a.x - b.x);
  const units: typeof order[] = [];
  const at = new Map<string, number>();
  for (const f of order) {
    const k = f.group ? at.get(f.group) : undefined;
    if (k !== undefined) units[k].push(f);
    else { if (f.group) at.set(f.group, units.length); units.push([f]); }
  }
  const inner = 24, gap = 96, label = 28;
  const size = (u: typeof order) => ({
    w: u.reduce((s, f) => s + framePx(f).w * BOARD_SCALE, 0) + inner * (u.length - 1),
    h: Math.max(...u.map(f => framePx(f).h * BOARD_SCALE)) + label,
  });
  const sizes = units.map(size);
  const uw = sizes.reduce((s, x) => s + x.w, 0) / units.length, uh = Math.max(...sizes.map(x => x.h));
  const perRow = Math.max(1, Math.min(units.length, Math.round(Math.sqrt(units.length * aspect * (uh + gap) / (uw + gap)))));
  const x0 = Math.min(...frames.map(f => f.x)), y0 = Math.min(...frames.map(f => f.y));
  let y = y0;
  for (let i = 0; i < units.length; i += perRow) {
    const row = units.slice(i, i + perRow);
    let x = x0;
    for (const u of row) {
      let fx = x;
      for (const f of u) { out.set(f.id, { x: Math.round(fx), y: Math.round(y) }); fx += framePx(f).w * BOARD_SCALE + inner; }
      x += size(u).w + gap;
    }
    y += Math.max(...row.map(size).map(s => s.h)) + gap;
  }
  return out;
}
