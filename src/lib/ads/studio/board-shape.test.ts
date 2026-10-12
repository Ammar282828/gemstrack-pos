import { describe, expect, it } from 'vitest';
import { applyOps, cleanDoc, nextSpot, framePx, BOARD_SCALE, GAP, type Board } from './board-shape';
import { blankAd } from './templates';

const empty = (): Board => ({ id: 'b1', name: 'Eid', frames: [], notes: [], rev: 1, updated: '', by: 'x' });
const fields = { kicker: 'Rings', headline: 'Emerald halo', weight: '21K · 4.2g', details: 'Message us' };

describe('board operations', () => {
  it('adds a design to the right of the last, and places one beside the design it came from', () => {
    let { board, added } = applyOps(empty(), [{ op: 'add', frame: { assetId: 'site:1', format: 'portrait', fields } }]);
    expect(board.frames[0]).toMatchObject({ x: 0, y: 0, rev: 1, template: 'headline', doc: null });
    ({ board } = applyOps(board, [{ op: 'add', frame: { assetId: 'site:2', format: 'square' } }]));
    expect(board.frames[1].x).toBe(1080 * BOARD_SCALE + GAP);
    ({ board, added } = applyOps(board, [{ op: 'add', near: board.frames[0].id, frame: { assetId: 'site:1', format: 'story' } }]));
    // Beside the first — but the second already sits there, so after it.
    const third = board.frames.find(f => f.id === added[0])!;
    expect(third.x).toBe(board.frames[1].x + 1080 * BOARD_SCALE + GAP);
    expect(third.y).toBe(0);
  });

  it('bumps a design’s rev on a change, not on a move; refuses an unknown one', () => {
    const { board: b1, added } = applyOps(empty(), [{ op: 'add', frame: { assetId: null, fields } }]);
    const id = added[0];
    const { board: b2 } = applyOps(b1, [{ op: 'put', id, patch: { label: 'New name', fields: { ...fields, headline: 'Changed' } } }, { op: 'move', id, x: 500, y: 40 }]);
    expect(b2.frames[0]).toMatchObject({ label: 'New name', rev: 2, x: 500, y: 40 });
    expect(b2.frames[0].fields.headline).toBe('Changed');
    expect(() => applyOps(b2, [{ op: 'put', id: 'nope', patch: {} }])).toThrow(/no design/);
  });

  it('keeps notes: words required, edited, moved, removed', () => {
    expect(() => applyOps(empty(), [{ op: 'note', note: { text: '   ' } }])).toThrow(/needs words/);
    const { board, added } = applyOps(empty(), [{ op: 'note', note: { text: 'Eid gifting, six rings', by: 'agent' } }]);
    expect(board.notes[0]).toMatchObject({ text: 'Eid gifting, six rings', by: 'agent' });
    const { board: b2 } = applyOps(board, [{ op: 'noteText', id: added[0], text: 'Five rings' }, { op: 'noteMove', id: added[0], x: 9, y: 9 }]);
    expect(b2.notes[0]).toMatchObject({ text: 'Five rings', x: 9, y: 9 });
    expect(applyOps(b2, [{ op: 'noteRemove', id: added[0] }]).board.notes).toHaveLength(0);
  });
});

describe('a layout document from outside', () => {
  it('passes the maker’s own, and takes uploaded pictures out', () => {
    const doc = { ...blankAd('square'), layers: [{ id: 'i', kind: 'image', photoId: 'photo', src: 'data:image/png;base64,AAAA', x: 1, y: 1, w: 10, radius: 0, border: null, shadow: false, rotate: 0, opacity: 1 }] };
    const out = cleanDoc(doc);
    expect(out.frame).toEqual({ w: 1080, h: 1080 });
    expect((out.layers[0] as { src?: string }).src).toBeUndefined();
  });

  it('refuses what the renderer can’t draw, saying why', () => {
    expect(() => cleanDoc({ layers: [] })).toThrow(/no `bg`/);
    expect(() => cleanDoc({ bg: {}, layers: [{ kind: 'video' }] })).toThrow(/layer 0/);
    expect(() => cleanDoc({ bg: {}, layers: [{ id: 't', kind: 'text', text: 'x', x: 'left' }] })).toThrow(/x that is not a number/);
    expect(() => cleanDoc({ bg: {}, layers: Array.from({ length: 81 }, (_, i) => ({ id: `r${i}`, kind: 'rect' })) })).toThrow(/80 layers/);
  });

  it('sizes a design by its document, else its shape', () => {
    expect(framePx({ format: 'story', doc: null })).toEqual({ w: 1080, h: 1920 });
    expect(nextSpot([], { w: 1080, h: 1350 })).toEqual({ x: 0, y: 0 });
  });
});

describe('a layout that suits the photo and shape', () => {
  it('frames a story and a marked photo; leaves the rest', async () => {
    const { safeTemplate } = await import('./board-shape');
    expect(safeTemplate('headline', { marked: false, format: 'story' })).toBe('framed');
    expect(safeTemplate('band', { marked: true, format: 'portrait' })).toBe('framed');
    expect(safeTemplate('heritage', { marked: true, format: 'story' })).toBe('heritage');
    expect(safeTemplate('headline', { marked: false, format: 'portrait' })).toBe('headline');
  });
});

describe('Designer v2 fields in a document from outside', () => {
  const bg = { photoId: null, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#fff' };
  const grad = { type: 'linear', angle: 100, stops: [{ at: 0, color: '#8C6A25' }, { at: 1, color: '#FBEFC4', alpha: 0.9 }] };
  const text = { id: 't', kind: 'text', text: 'Price Rs 125,000', x: 10, y: 10, size: 40, font: 'regular', color: '#111', align: 'left', width: 400, fit: false, spacing: 0, lineHeight: 1.1, upper: false, shadow: false, box: null, rotate: 0, opacity: 1 };
  const qr = { id: 'q', kind: 'qr', x: 100, y: 100, w: 240, value: 'https://wa.me/923001234567', fg: '#111111', bg: '#ffffff', quiet: 4, rotate: 0, opacity: 1 };
  const withLayer = (l: object, over: object = {}) => ({ bg, layers: [l], ...over });

  it('round-trips every new key', () => {
    const layers = [
      { ...text, blend: 'soft-light', role: 'headline', layerFx: { shadow: { color: '#000', x: 0, y: 8, blur: 20, alpha: 0.4 }, glow: { color: '#fd8', blur: 30, alpha: 0.7 }, outline: { color: '#fff', width: 4 } }, runs: [{ from: 6, to: 16, font: 'bold', color: '#C9973F', size: 1.5, upper: false, underline: true, gradient: grad }], list: 'bullet', fillGradient: grad },
      { id: 'r', kind: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000', stroke: 0, fill: null, curve: 0, radius: 0, rotate: 0, opacity: 1, fillGradient: grad, blend: 'multiply' },
      { id: 'i', kind: 'image', photoId: 'p', x: 0, y: 0, w: 100, radius: 0, border: null, shadow: false, rotate: 0, opacity: 1, cutout: true, adjust: { brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0, highlights: -30, shadows: 20, tint: 5, hue: 0, sharpen: 40, blur: 0, grain: 10 } },
      qr,
    ];
    const doc = { bg: { ...bg, fill: { ...grad, type: 'radial' }, adjust: { brightness: 1, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0, grain: 12 } }, layers, meta: { template: 'headline', master: 'p1', guides: { x: [100, 540], y: [200] }, subject: { x: 0.2, y: 0.3, w: 0.5, h: 0.4 }, grid: 40 } };
    expect(cleanDoc(doc)).toEqual(doc);
  });

  it('knows the qr kind', () => {
    expect(cleanDoc(withLayer(qr)).layers[0]).toMatchObject({ kind: 'qr', value: 'https://wa.me/923001234567' });
    expect(() => cleanDoc(withLayer({ ...qr, w: NaN }))).toThrow(/w that is not a number/);
    expect(() => cleanDoc(withLayer({ ...qr, value: '' }))).toThrow(/QR code/);
    expect(() => cleanDoc(withLayer({ ...qr, value: 'x'.repeat(501) }))).toThrow(/QR code/);
    expect(() => cleanDoc(withLayer({ ...qr, quiet: 20 }))).toThrow(/quiet zone/);
    expect(() => cleanDoc(withLayer({ ...qr, bg: 5 }))).toThrow(/background/);
  });

  it('refuses junk in the new keys, saying which', () => {
    expect(() => cleanDoc(withLayer({ ...text, blend: 'burn' }))).toThrow(/blend/);
    expect(() => cleanDoc(withLayer({ ...text, role: 'boss' }))).toThrow(/role/);
    expect(() => cleanDoc(withLayer({ ...text, layerFx: { shadow: { color: '#000', x: 0, y: NaN, blur: 1, alpha: 1 } } }))).toThrow(/shadow/);
    expect(() => cleanDoc(withLayer({ ...text, layerFx: { glow: { color: '#000', blur: 9999, alpha: 1 } } }))).toThrow(/glow/);
    expect(() => cleanDoc(withLayer({ ...text, layerFx: 'big' }))).toThrow(/layerFx/);
    expect(() => cleanDoc(withLayer({ ...text, list: 'roman' }))).toThrow(/list/);
    expect(() => cleanDoc(withLayer({ ...text, fillGradient: { ...grad, stops: [grad.stops[0]] } }))).toThrow(/stops/);
    expect(() => cleanDoc(withLayer({ ...text, runs: [{ from: 'a', to: 3 }] }))).toThrow(/run/);
    expect(() => cleanDoc(withLayer({ ...text, runs: [{ from: 5, to: 3 }] }))).toThrow(/run/);
    expect(() => cleanDoc(withLayer({ ...text, runs: [{ from: 0, to: 3, font: 'comic' }] }))).toThrow(/font/);
    expect(() => cleanDoc(withLayer({ ...text, runs: [{ from: 0, to: 3, size: 100 }] }))).toThrow(/size/);
    expect(() => cleanDoc(withLayer({ ...text, runs: Array.from({ length: 61 }, () => ({ from: 0, to: 1 })) }))).toThrow(/at most 60/);
    expect(() => cleanDoc(withLayer({ id: 'i', kind: 'image', photoId: 'p', x: 0, y: 0, w: 1, cutout: 'yes' }))).toThrow(/cutout/);
    expect(() => cleanDoc(withLayer({ id: 'i', kind: 'image', photoId: 'p', x: 0, y: 0, w: 1, adjust: { sharpen: NaN } }))).toThrow(/sharpen/);
    expect(() => cleanDoc({ bg: { ...bg, fill: { type: 'linear' } }, layers: [] })).toThrow(/gradient/);
    expect(() => cleanDoc({ bg, layers: [], meta: { grid: -4 } })).toThrow(/grid/);
    expect(() => cleanDoc({ bg, layers: [], meta: { guides: { x: [1, NaN], y: [] } } })).toThrow(/guides/);
    expect(() => cleanDoc({ bg, layers: [], meta: { subject: { x: 0, y: 0, w: 2, h: 1 } } })).toThrow(/subject/);
  });

  it('still passes documents saved before any of it', () => {
    expect(cleanDoc(withLayer(text)).layers).toHaveLength(1);
  });
});
