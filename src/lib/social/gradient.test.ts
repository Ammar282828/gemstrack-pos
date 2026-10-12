import { describe, expect, it } from 'vitest';
import type { Gradient } from './editor';
import { GOLD_FOIL, colorWithAlpha, gradientAt, gradientCss, gradientLine, gradientProblem, makeGradient, normalizeGradient, parseColor, reverseGradient, simpleGradient } from './gradient';
import { makeHarness } from './render-harness';

describe('gradient stops', () => {
  it('sorts and clamps the stops, keeping equal ones in order', () => {
    const g = normalizeGradient({ type: 'linear', angle: 180, stops: [{ at: 1.4, color: '#000' }, { at: -2, color: '#111' }, { at: 0.5, color: '#222', alpha: 3 }, { at: 0.5, color: '#333' }] });
    expect(g.stops.map(s => [s.at, s.color])).toEqual([[0, '#111'], [0.5, '#222'], [0.5, '#333'], [1, '#000']]);
    expect(g.stops[1].alpha).toBe(1);
  });
  it('always has two stops, and drops stops that are not numbers', () => {
    expect(normalizeGradient({ type: 'linear', angle: 0, stops: [] }).stops.length).toBe(2);
    expect(normalizeGradient({ type: 'linear', angle: 0, stops: [{ at: 0.3, color: '#abc' }] }).stops.map(s => s.at)).toEqual([0.3, 1]);
    expect(normalizeGradient({ type: 'radial', angle: NaN, stops: [{ at: NaN, color: '#000' }, { at: 0, color: '#111' }, { at: 1, color: '#222' }] })).toMatchObject({ angle: 180, stops: [{ at: 0 }, { at: 1 }] });
  });
  it('reads colours and mixes alpha into them', () => {
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseColor('#c9973f80')?.a).toBeCloseTo(0.502, 2);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('gold')).toBeNull();
    expect(colorWithAlpha('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
    expect(colorWithAlpha('#ff0000')).toBe('#ff0000');
    expect(colorWithAlpha('gold', 0.5)).toBe('gold');
  });
  it('samples the colour along it', () => {
    const g = simpleGradient('#000000', '#ffffff');
    expect(gradientAt(g, 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    expect(gradientAt(g, -1)?.r).toBe(0);
    expect(gradientAt(g, 2)?.r).toBe(255);
    expect(gradientAt(reverseGradient(g), 0)?.r).toBe(255);
    expect(gradientAt({ type: 'linear', angle: 0, stops: [{ at: 0, color: '#000000', alpha: 0 }, { at: 1, color: '#000000' }] }, 0.25)?.a).toBeCloseTo(0.25);
  });
});

describe('gradient geometry', () => {
  const box = { x: 0, y: 0, w: 200, h: 100 };
  it('runs top to bottom at 180° and left to right at 90°', () => {
    const down = gradientLine({ type: 'linear', angle: 180, stops: [] }, box);
    expect([down.x0, down.y0, down.x1, down.y1].map(n => Math.round(n) + 0)).toEqual([100, 0, 100, 100]);
    const across = gradientLine({ type: 'linear', angle: 90, stops: [] }, box);
    expect([across.x0, across.y0, across.x1, across.y1].map(n => Math.round(n) + 0)).toEqual([0, 50, 200, 50]);
  });
  it('reaches the corners at 45°', () => {
    const l = gradientLine({ type: 'linear', angle: 45, stops: [] }, { x: 0, y: 0, w: 100, h: 100 });
    expect(Math.round(l.x0)).toBe(0); expect(Math.round(l.y1) + 0).toBe(0);
    expect(Math.round(l.x1)).toBe(100); expect(Math.round(l.y0)).toBe(100);
  });
  it('makes canvas gradients with every stop, radial to the farthest corner', () => {
    const h = makeHarness();
    try {
      makeGradient(h.ctx, GOLD_FOIL, box);
      makeGradient(h.ctx, { type: 'radial', angle: 0, stops: [{ at: 0, color: '#fff' }, { at: 1, color: '#000', alpha: 0.4 }] }, box);
      expect(h.log.filter(l => l.includes('createLinearGradient')).length).toBe(1);
      expect(h.log.filter(l => /grad#\d\.stop/.test(l)).length).toBe(7);
      expect(h.log.find(l => l.includes('createRadialGradient'))).toContain(`100,50,111.803`);
      expect(h.log).toContain('grad#2.stop(1,rgba(0,0,0,0.4))');
    } finally { h.restore(); }
  });
  it('writes CSS for the panel', () => {
    expect(gradientCss(simpleGradient('#000000', '#ffffff', 90))).toBe('linear-gradient(90deg, #000000 0%, #ffffff 100%)');
    expect(gradientCss({ type: 'radial', angle: 0, stops: [{ at: 0, color: '#ff0000', alpha: 0.5 }, { at: 1, color: '#00f' }] })).toBe('radial-gradient(circle farthest-corner, rgba(255,0,0,0.5) 0%, #00f 100%)');
  });
});

describe('gradients from outside', () => {
  const ok: Gradient = simpleGradient('#000', '#fff');
  it('accepts a good one', () => { expect(gradientProblem(ok)).toBeNull(); expect(gradientProblem(GOLD_FOIL)).toBeNull(); });
  it('names what is wrong', () => {
    expect(gradientProblem(null)).toMatch(/not an object/);
    expect(gradientProblem({ ...ok, type: 'conic' })).toMatch(/type/);
    expect(gradientProblem({ ...ok, angle: NaN })).toMatch(/angle/);
    expect(gradientProblem({ ...ok, stops: [ok.stops[0]] })).toMatch(/2 to 8/);
    expect(gradientProblem({ ...ok, stops: [...ok.stops, { at: 2, color: '#000' }] })).toMatch(/position/);
    expect(gradientProblem({ ...ok, stops: [{ at: 0, color: '' }, ok.stops[1]] })).toMatch(/colour/);
    expect(gradientProblem({ ...ok, stops: [{ at: 0, color: '#000', alpha: 2 }, ok.stops[1]] })).toMatch(/opacity/);
  });
});
