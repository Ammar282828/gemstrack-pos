import { describe, expect, it } from 'vitest';
import { NO_ADJUST, applyAdjust, boxBlurRGBA, changesPixels, isPlain, snapBox, snapLines, snapMove, spacingSnap, type Adjust } from './design';

/** A w × h picture of one grey, or of a left half and right half. */
const flat = (w: number, h: number, v: number) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return d; };
const split = (w: number, h: number, a: number, b: number) => { const d = flat(w, h, a); for (let y = 0; y < h; y++) for (let x = w / 2; x < w; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = b; } return d; };
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4];

describe('the new photo controls', () => {
  const NEW: (keyof Adjust)[] = ['highlights', 'shadows', 'tint', 'hue', 'sharpen', 'blur', 'grain'];
  it('leave the pixels alone at 0, missing, or on an old Adjust', () => {
    const sample = () => { const d = new Uint8ClampedArray(24 * 4); for (let i = 0; i < d.length; i++) d[i] = (i * 37 + 11) % 256; return d; };
    const was = sample();
    const zeros = Object.fromEntries(NEW.map(k => [k, 0]));
    for (const a of [NO_ADJUST, { ...NO_ADJUST, ...zeros }] as Adjust[]) {
      const d = sample();
      applyAdjust(d, a, 6, 4);
      expect([...d]).toEqual([...was]);
      expect(isPlain(a)).toBe(true);
    }
    // And the older controls come out exactly as before when the new ones are present but zero.
    const a = sample(), b = sample();
    applyAdjust(a, { ...NO_ADJUST, brightness: 20, contrast: 15, warmth: 30, saturation: -10, fade: 12 });
    applyAdjust(b, { ...NO_ADJUST, ...zeros, brightness: 20, contrast: 15, warmth: 30, saturation: -10, fade: 12 }, 6, 4);
    expect([...b]).toEqual([...a]);
  });
  it('count as changing the pixels', () => {
    for (const k of NEW) { expect(changesPixels({ ...NO_ADJUST, [k]: 10 })).toBe(true); expect(isPlain({ ...NO_ADJUST, [k]: 10 })).toBe(false); }
  });
  it('lift shadows and recover highlights, more as the slider goes further', () => {
    const at = (v: number, a: Partial<Adjust>) => { const d = flat(1, 1, v); applyAdjust(d, { ...NO_ADJUST, ...a }); return d[0]; };
    expect(at(30, { shadows: 40 })).toBeGreaterThan(at(30, { shadows: 20 }));
    expect(at(30, { shadows: 20 })).toBeGreaterThan(30);
    expect(at(225, { highlights: -40 })).toBeLessThan(at(225, { highlights: -20 }));
    expect(at(225, { highlights: -20 })).toBeLessThan(225);
    // Shadows leave the brights nearly alone, and highlights the darks.
    expect(at(240, { shadows: 100 }) - 240).toBeLessThan(2);
    expect(at(15, { highlights: -100 })).toBeGreaterThanOrEqual(14);
    expect(at(15, { highlights: -100 })).toBeLessThanOrEqual(15);
  });
  it('tint toward green or magenta, and turn the hue', () => {
    const d = flat(1, 1, 128); applyAdjust(d, { ...NO_ADJUST, tint: 50 });
    expect(d[1]).toBeLessThan(128); expect(d[0]).toBeGreaterThan(128);
    const e = flat(1, 1, 128); applyAdjust(e, { ...NO_ADJUST, tint: -50 });
    expect(e[1]).toBeGreaterThan(128);
    const red = new Uint8ClampedArray([255, 0, 0, 255]);
    applyAdjust(red, { ...NO_ADJUST, hue: 66.67 }); // a third of the way round: red turns to green
    expect(red[1]).toBeGreaterThan(red[0]); expect(red[1]).toBeGreaterThan(red[2]);
    const grey = flat(1, 1, 100); applyAdjust(grey, { ...NO_ADJUST, hue: 50 });
    expect(Math.abs(grey[0] - grey[1])).toBeLessThanOrEqual(1); // greys stay grey
  });
  it('blur an edge smoothly and keep flat ground flat', () => {
    const w = 32, h = 8;
    const d = split(w, h, 0, 255);
    applyAdjust(d, { ...NO_ADJUST, blur: 60 }, w, h);
    const row = Array.from({ length: w }, (_, x) => px(d, w, x, 3));
    expect(row[0]).toBeLessThan(5); expect(row[w - 1]).toBeGreaterThan(250);
    for (let x = 1; x < w; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]); // monotone across the edge
    expect(row[w / 2 - 1]).toBeGreaterThan(0); expect(row[w / 2]).toBeLessThan(255);
    const f = flat(16, 16, 77); applyAdjust(f, { ...NO_ADJUST, blur: 100, sharpen: 100 }, 16, 16);
    expect([...f].filter((v, i) => i % 4 < 3).every(v => v === 77)).toBe(true);
    expect(f[3]).toBe(255);
    const more = split(w, h, 0, 255); applyAdjust(more, { ...NO_ADJUST, blur: 100 }, w, h);
    expect(px(more, w, w / 2 - 1, 3)).toBeGreaterThanOrEqual(px(d, w, w / 2 - 1, 3)); // a bigger blur spreads further
  });
  it('sharpen an edge with overshoot and leave flat ground alone', () => {
    const w = 64, h = 8;
    const d = split(w, h, 80, 170);
    applyAdjust(d, { ...NO_ADJUST, sharpen: 100 }, w, h);
    expect(px(d, w, w / 2 - 1, 3)).toBeLessThan(80); // darker on the dark side of the edge
    expect(px(d, w, w / 2, 3)).toBeGreaterThan(170); // lighter on the light side
    expect(px(d, w, 2, 3)).toBe(80); expect(px(d, w, w - 3, 3)).toBe(170);
  });
  it('add the same grain every time, centred on the picture', () => {
    const a = flat(40, 40, 128), b = flat(40, 40, 128);
    applyAdjust(a, { ...NO_ADJUST, grain: 60 }, 40, 40); applyAdjust(b, { ...NO_ADJUST, grain: 60 }, 40, 40);
    expect([...a]).toEqual([...b]);
    let sum = 0, min = 255, max = 0;
    for (let i = 0; i < a.length; i += 4) { sum += a[i]; min = Math.min(min, a[i]); max = Math.max(max, a[i]); }
    expect(Math.abs(sum / 1600 - 128)).toBeLessThan(2);
    expect(max - min).toBeGreaterThan(10);
    const low = flat(40, 40, 128); applyAdjust(low, { ...NO_ADJUST, grain: 10 }, 40, 40);
    let lo = 255, hi = 0; for (let i = 0; i < low.length; i += 4) { lo = Math.min(lo, low[i]); hi = Math.max(hi, low[i]); }
    expect(hi - lo).toBeLessThan(max - min);
  });
  it('need the picture’s shape for blur, sharpen and grain, and do nothing without it', () => {
    const d = split(8, 4, 0, 255); const was = [...d];
    applyAdjust(d, { ...NO_ADJUST, blur: 80, sharpen: 80, grain: 80 });
    expect([...d]).toEqual(was);
    applyAdjust(d, { ...NO_ADJUST, blur: 80 }, 3, 3); // wrong shape: ignored
    expect([...d]).toEqual(was);
  });
  it('blur in time proportional to the pixels, not the radius', () => {
    const w = 400, h = 400, d = split(w, h, 0, 255);
    const t0 = Date.now();
    boxBlurRGBA(d, w, h, 40, 3);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('snapping with a grid, guides and equal spacing', () => {
  it('adds grid lines and the user’s guides to the snap lines', () => {
    const lines = snapLines({ w: 1080, h: 1920 }, 96, [], { grid: 100, guides: { x: [333], y: [777, NaN] } });
    expect(lines.xs).toEqual(expect.arrayContaining([100, 200, 1000, 333]));
    expect(lines.ys).toEqual(expect.arrayContaining([100, 1900, 777]));
    expect(lines.ys.some(Number.isNaN)).toBe(false);
    expect(snapBox({ x: 197, y: 5, w: 50, h: 50 }, lines, 8).v).toBe(200);
    expect(snapLines({ w: 1080, h: 1920 }, 96, []).xs.length).toBe(3); // no grid unless asked
    expect(snapLines({ w: 1080, h: 1920 }, 96, [], { grid: 1 }).xs.length).toBe(3); // a silly grid is ignored
  });

  it('makes the gaps either side equal', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }, c = { x: 500, y: 0, w: 100, h: 100 };
    const moving = { x: 262, y: 10, w: 100, h: 80 }; // gap left 162, right 138
    const s = spacingSnap(moving, [a, c], 20, 'x');
    expect(s.d).toBe(-12);
    expect(s.guides).toHaveLength(2);
    expect(s.guides.map(g => g.gap)).toEqual([150, 150]);
    expect(s.guides[0]).toMatchObject({ axis: 'x', a: 100, b: 250 });
    expect(spacingSnap({ ...moving, x: 200 }, [a, c], 20, 'x').guides).toEqual([]); // out of reach
  });

  it('repeats the gap of a neighbouring pair', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 }, b = { x: 150, y: 0, w: 100, h: 100 }; // gap 50
    const s = spacingSnap({ x: 306, y: 0, w: 100, h: 100 }, [a, b], 12, 'x');
    expect(s.d).toBe(-6); // to x = 300
    expect(s.guides.map(g => g.gap)).toEqual([50, 50]);
    const before = spacingSnap({ x: -145, y: 0, w: 100, h: 100 }, [a, b], 12, 'x');
    expect(before.d).toBe(-5); // to x = -150
  });

  it('only counts boxes level with the moving one, and works down the page too', () => {
    const above = { x: 0, y: 0, w: 100, h: 100 }, below = { x: 0, y: 500, w: 100, h: 100 }, far = { x: 600, y: 900, w: 100, h: 100 };
    const moving = { x: 0, y: 255, w: 100, h: 100 };
    expect(spacingSnap(moving, [above, far, below], 20, 'x').guides).toEqual([]);
    const v = spacingSnap(moving, [above, below], 20, 'y');
    expect(v.d).toBe(-5);
    expect(v.guides.every(g => g.axis === 'y' && g.at === 50)).toBe(true);
  });

  it('lets a line win on an axis and spacing take the other', () => {
    const lines = snapLines({ w: 1080, h: 1920 }, 96, []);
    const a = { x: 0, y: 700, w: 100, h: 100 }, c = { x: 500, y: 700, w: 100, h: 100 };
    const r = snapMove({ x: 262, y: 704, w: 100, h: 100 }, lines, [a, c], 20);
    expect(r.dx).toBe(-12);
    expect(r.spacing.length).toBe(2);
    const onCentre = snapMove({ x: 497, y: 704, w: 100, h: 100 }, lines, [a, c], 20); // the centre line (540 vs 547) beats spacing
    expect(onCentre.v).toBe(540);
    expect(onCentre.dx).toBe(-7);
  });
});
