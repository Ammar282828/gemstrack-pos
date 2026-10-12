import { afterEach, describe, expect, it } from 'vitest';
import {
  BADGES, FONT_KEYS, FONT_LABEL, FX_DEFAULTS, TEXT_STYLES, applyPreset, applySquarePreset, emptyDoc, emptySquare, fontCss, layerBox, layoutText, newCornerMark, newQr,
  newWeightStamp, normalizeRuns, renderDoc, scaleLayer, setRunStyle, shiftRuns, textLayer,
  type Assets, type Fields, type FontFamilies, type Layer, type QrLayer, type ShapeLayer, type StoryDoc, type TextLayer,
} from './editor';
import { makeHarness, type Harness } from './render-harness';
import { PALETTES } from './palettes';
import { STORY_FRAME } from './story';

const fonts: FontFamilies = { headline: 'H', body: 'B', serif: 'S' };
const fields: Fields = { kicker: '', headline: 'Emerald halo', weight: '21K · 4.2g', details: 'Message us' };
const base = { rotate: 0, opacity: 1 };

let h: Harness | undefined;
afterEach(() => h?.restore());
const setup = () => {
  h = makeHarness();
  const assets: Assets = { photos: { p1: h.image('p1', 600, 400) }, marks: { wordmark: h.image('wordmark', 400, 100) }, fonts };
  return { h, assets };
};
const doc = (layers: Layer[], over: Partial<StoryDoc['bg']> = {}): StoryDoc => ({ ...emptyDoc(null), bg: { ...emptyDoc(null).bg, ...over }, layers });
const txt = (o: Partial<TextLayer>): TextLayer => textLayer({ x: 100, y: 100, size: 40, font: 'regular', color: '#111111', width: 400, text: '', ...o });
const rect = (o: Partial<ShapeLayer> = {}): ShapeLayer => ({ id: 'r', kind: 'rect', x: 100, y: 200, w: 300, h: 160, color: '#f00', stroke: 0, fill: '#0f0', curve: 0, radius: 0, ...base, ...o });
const calls = (log: string[], re: RegExp) => log.filter(l => re.test(l));

describe('rich text', () => {
  it('lays a run in its own size and wraps across runs', () => {
    const { h } = setup();
    // 40 px type is 20 px a character here; the run makes "bbbb cccc" twice that. Width 400 = 20 small characters.
    const l = txt({ text: 'aaaa bbbb cccc dddd', width: 400, runs: [{ from: 5, to: 14, size: 2 }] });
    const t = layoutText(h.ctx, l, fields, fonts);
    expect(t.lines).toEqual(['aaaa bbbb', 'cccc dddd']);
    const first = t.rich!.lines[0];
    expect(first.pieces.map(p => p.text)).toEqual(['aaaa ', 'bbbb']);
    expect(first.pieces[1].w).toBe(4 * 40); // 80 px type = 40 px a character
    expect(first.size).toBe(80); // the line is as tall as its biggest type
    expect(t.rich!.lines[1].top).toBeCloseTo(80 * 1.15, 5);
  });

  it('keeps plain text unchanged: no runs, no list means the old layout', () => {
    const { h } = setup();
    const t = layoutText(h.ctx, txt({ text: 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk' }), fields, fonts);
    expect(t.rich).toBeUndefined();
    expect(t.lines.length).toBe(3);
  });

  it('numbers a list, skipping blank lines, and hangs wrapped lines under the words', () => {
    const { h } = setup();
    const t = layoutText(h.ctx, txt({ text: 'One\nTwo\n\nThree is a much longer item that wraps round', list: 'number', width: 420 }), fields, fonts);
    expect(t.lines.slice(0, 3)).toEqual(['1. One', '2. Two', '']);
    expect(t.lines[3].startsWith('3. Three')).toBe(true);
    const wrapped = t.rich!.lines.filter((x, i) => i > 3);
    expect(wrapped.length).toBeGreaterThan(0);
    expect(wrapped.every(x => x.marker === null && x.markerW > 0)).toBe(true);
    const bullets = layoutText(h.ctx, txt({ text: 'Gold\nRuby', list: 'bullet' }), fields, fonts);
    expect(bullets.lines).toEqual(['• Gold', '• Ruby']);
  });

  it('draws each piece in its font, size and colour', () => {
    const { h, assets } = setup();
    const l = txt({ text: 'Price Rs 125,000', runs: [{ from: 6, to: 16, font: 'bold', color: '#C9973F', size: 1.5 }], align: 'left', width: 800 });
    renderDoc(h.ctx, doc([l]), fields, assets);
    const texts = calls(h.log, /^ctx\.fillText/);
    expect(texts).toEqual(['ctx.fillText("Price ",100,149.2)', 'ctx.fillText("Rs 125,000",220,149.2)']);
    expect(h.log).toContain('ctx.font="700 60px B"');
    expect(h.log).toContain('ctx.fillStyle="#C9973F"');
  });

  it('uppercases per character and keeps runs on the words as written', () => {
    const { h } = setup();
    const t = layoutText(h.ctx, txt({ text: 'gold ring', upper: true, runs: [{ from: 0, to: 4, underline: true }] }), fields, fonts);
    expect(t.lines).toEqual(['GOLD RING']);
  });

  it('shrinks rich text to fit its width', () => {
    const { h } = setup();
    const t = layoutText(h.ctx, txt({ text: 'a very long headline that cannot fit', fit: true, width: 200, runs: [{ from: 0, to: 3, color: '#f00' }] }), fields, fonts);
    expect(t.rich!.lines.length).toBe(1);
    expect(t.w).toBeLessThanOrEqual(200 + 1);
    expect(t.size).toBeLessThan(40);
  });

  it('bound text takes runs from the field', () => {
    const { h } = setup();
    const t = layoutText(h.ctx, txt({ bind: 'weight', runs: [{ from: 0, to: 3, font: 'bold' }] }), fields, fonts);
    expect(t.rich!.lines[0].pieces.map(p => p.text)).toEqual(['21K', ' · 4.2g']);
  });
});

describe('editing runs', () => {
  it('styles a range, cutting and joining runs', () => {
    let runs = setRunStyle(undefined, 2, 6, { color: '#f00' }, 10);
    expect(runs).toEqual([{ from: 2, to: 6, color: '#f00' }]);
    runs = setRunStyle(runs, 4, 8, { font: 'bold' }, 10);
    expect(runs).toEqual([{ from: 2, to: 4, color: '#f00' }, { from: 4, to: 6, color: '#f00', font: 'bold' }, { from: 6, to: 8, font: 'bold' }]);
    // Clearing the colour over the lot and the same weight joins the neighbours.
    runs = setRunStyle(runs, 2, 8, { color: undefined, font: 'bold' }, 10);
    expect(runs).toEqual([{ from: 2, to: 8, font: 'bold' }]);
    expect(setRunStyle(runs, 2, 8, { font: undefined }, 10)).toEqual([]);
  });
  it('keeps runs inside the words', () => {
    expect(normalizeRuns([{ from: -3, to: 4 }, { from: 8, to: 99 }, { from: 5, to: 5 }, { from: NaN, to: 2 }], 10)).toEqual([{ from: 0, to: 4 }, { from: 8, to: 10 }]);
  });
  it('moves runs with typing: carried on at the end, not at the start', () => {
    const runs = [{ from: 4, to: 8, color: '#f00' }];
    expect(shiftRuns(runs, 8, 0, 3)).toEqual([{ from: 4, to: 11, color: '#f00' }]); // typed at the end
    expect(shiftRuns(runs, 4, 0, 3)).toEqual([{ from: 7, to: 11, color: '#f00' }]); // typed at the start
    expect(shiftRuns(runs, 0, 2, 0)).toEqual([{ from: 2, to: 6, color: '#f00' }]);
    expect(shiftRuns(runs, 3, 6, 0)).toEqual([]); // the whole stretch deleted
  });
});

describe('gradients, blends and effects', () => {
  it('fills text, a shape and the background with gradients', () => {
    const { h, assets } = setup();
    const g = { type: 'linear' as const, angle: 90, stops: [{ at: 0, color: '#8C6A25' }, { at: 0.5, color: '#FBEFC4' }, { at: 1, color: '#7A5A1E' }] };
    const radial = { type: 'radial' as const, angle: 0, stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#000000', alpha: 0.5 }] };
    renderDoc(h.ctx, doc([txt({ text: 'Gold', fillGradient: g }), rect({ fillGradient: radial })], { fill: radial }), fields, assets);
    expect(calls(h.log, /createRadialGradient/).length).toBe(2); // the background and the shape
    expect(calls(h.log, /createLinearGradient/).length).toBe(1); // the text
    expect(h.log.filter(l => /^grad#\d+\.stop/.test(l)).length).toBe(2 + 2 + 3);
    expect(h.log).toContain('grad#1.stop(1,rgba(0,0,0,0.5))');
  });

  it('keeps the older two-colour fill when there is no gradient', () => {
    const { h, assets } = setup();
    renderDoc(h.ctx, doc([rect({ fill2: '#00f' })]), fields, assets);
    expect(calls(h.log, /createLinearGradient/).length).toBe(1);
  });

  it('mixes a layer with a blend mode and only that layer', () => {
    const { h, assets } = setup();
    renderDoc(h.ctx, doc([rect({ blend: 'multiply' }), rect({ id: 'r2', blend: 'normal' }), rect({ id: 'r3' })]), fields, assets);
    expect(calls(h.log, /globalCompositeOperation/)).toEqual(['ctx.globalCompositeOperation="multiply"']);
  });

  it('puts a shadow, glow and outline on a shape without drawing it more than once on top', () => {
    const { h, assets } = setup();
    const layerFx = { shadow: { color: '#000000', x: 4, y: 12, blur: 20, alpha: 0.4 }, glow: { color: '#FFD98A', blur: 30, alpha: 0.8 }, outline: { color: '#ffffff', width: 6 } };
    renderDoc(h.ctx, doc([rect({ layerFx })]), fields, assets);
    // The shape went into a canvas of its own; the page got two glow passes, one shadow pass and the layer itself.
    expect(calls(h.log, /^ctx\.drawImage/).length).toBe(4);
    expect(h.log).toContain('ctx.shadowColor="rgba(0,0,0,0.4)"');
    expect(h.log).toContain('ctx.shadowColor="rgba(255,217,138,0.8)"');
    expect(calls(h.log, /^canvas#\d+\.drawImage/).length).toBeGreaterThan(24); // the outline's stamped silhouettes
    // The last thing drawn has no shadow behind it.
    const last = h.log.lastIndexOf(calls(h.log, /^ctx\.drawImage/)[3]);
    expect(h.log.slice(last - 3, last).some(l => l.startsWith('ctx.shadowColor'))).toBe(false);
  });

  it('draws nothing extra for a layer with no effects', () => {
    const { h, assets } = setup();
    renderDoc(h.ctx, doc([rect({ layerFx: {} })]), fields, assets);
    expect(calls(h.log, /drawImage|createElement/).length).toBe(0);
  });

  it('draws effects on images, marks and QR codes too', () => {
    const { h, assets } = setup();
    const layerFx = { shadow: FX_DEFAULTS.shadow };
    const layers: Layer[] = [
      { id: 'i', kind: 'image', photoId: 'p1', x: 100, y: 100, w: 300, radius: 0, border: null, shadow: true, layerFx, ...base },
      { id: 'm', kind: 'wordmark', mark: 'wordmark', x: 600, y: 100, width: 200, color: '#fff', autoColor: false, layerFx, ...base },
      { ...newQr('https://taheri.shop'), layerFx },
    ];
    renderDoc(h.ctx, doc(layers), fields, assets);
    expect(calls(h.log, /^ctx\.drawImage/).length).toBe(6); // a shadow pass and the layer, three times
  });

  it('draws a cut-out without its frame, its shadow following the picture', () => {
    const { h, assets } = setup();
    const cut: Layer = { id: 'c', kind: 'image', photoId: 'p1', x: 100, y: 100, w: 300, radius: 24, border: '#ffffff', shadow: true, cutout: true, ...base };
    renderDoc(h.ctx, doc([cut]), fields, assets);
    expect(calls(h.log, /^ctx\.(fill|stroke|clip)\(/).length).toBe(0);
    expect(h.log.indexOf('ctx.shadowBlur=30')).toBeLessThan(h.log.findIndex(l => l.startsWith('ctx.drawImage(img:p1')));
  });
});

describe('QR layers', () => {
  it('is a square, scales with the others, and draws its modules as one path', () => {
    const { h, assets } = setup();
    const q = newQr('https://wa.me/923001234567', '#111111', STORY_FRAME);
    expect(layerBox(q, fields, assets)).toEqual({ x: q.x, y: q.y, w: 300, h: 300 });
    expect((scaleLayer(q, 0.5) as QrLayer).w).toBe(150);
    renderDoc(h.ctx, doc([q]), fields, assets);
    expect(calls(h.log, /^ctx\.rect/).length).toBeGreaterThan(40);
    expect(calls(h.log, /^ctx\.fill\(/).length).toBe(1);
    expect(h.log).toContain('ctx.fillStyle="#FFFFFF"');
  });
  it('draws nothing for an empty or over-long value', () => {
    const { h, assets } = setup();
    renderDoc(h.ctx, doc([{ ...newQr(''), value: '' }, { ...newQr('x'), value: 'x'.repeat(400) }]), fields, assets);
    expect(calls(h.log, /^ctx\.rect/).length).toBe(0);
  });
});

describe('fonts and roles', () => {
  it('has the six new faces, each with a label and a CSS font', () => {
    const added = ['cormorant-infant', 'italiana', 'jost', 'tenor', 'dm-serif', 'marcellus'] as const;
    for (const k of added) {
      expect(FONT_KEYS).toContain(k);
      expect(FONT_LABEL[k]).toBeTruthy();
      expect(fontCss(k, 50, { ...fonts, extra: { italiana: 'It' } })).toMatch(/50px/);
    }
    expect(fontCss('italiana', 50, { ...fonts, extra: { italiana: 'It' } })).toBe('400 50px It');
  });

  it('marks what a layer is for', () => {
    const { assets } = setup();
    expect(newWeightStamp().role).toBe('specs');
    expect(newCornerMark('wordmark', assets).role).toBe('mark');
    const styled = TEXT_STYLES.flatMap(s => s.make('#111', STORY_FRAME));
    expect(styled.every(l => l.role)).toBe(true);
    expect(BADGES.flatMap(b => b.make('#c00', STORY_FRAME)).every(l => l.role === 'badge' || l.role === 'decor')).toBe(true);
    const placed = applyPreset(emptyDoc(null), 'stack-left', PALETTES[0], { ...fields, kicker: 'Rings' }, assets, { weightOwnLine: true, wordmark: true });
    expect(placed.layers.map(l => l.role)).toEqual(['mark', 'kicker', 'headline', 'specs', 'cta']);
    const square = applySquarePreset(emptySquare(), 'name', fields, assets);
    expect(square.layers.map(l => l.role)).toEqual(['headline', 'cta', 'mark']);
  });
});
