import { describe, expect, it } from 'vitest';
import type { Box, Layer, ShapeLayer, StoryDoc, TextLayer } from './editor';
import { buttonFromShape, canBeButton, newButton, wordsOn } from './button';

// A stand-in measure: text is 0.5 em a letter wide and one size tall, its top at y; the box as the engine grows it.
const boxOf = (l: Layer): Box => {
  if (l.kind === 'text') {
    const w = l.text.length * l.size * 0.5, h = l.size;
    const x = l.align === 'left' ? l.x : l.align === 'center' ? l.x - w / 2 : l.x - w;
    if (!l.box) return { x, y: l.y, w, h };
    const W = Math.max(w + l.box.pad * 2, l.box.w ?? 0), H = Math.max(h + l.box.pad * 2, l.box.h ?? 0);
    return { x: x + w / 2 - W / 2, y: l.y + h / 2 - H / 2, w: W, h: H };
  }
  const s = l as ShapeLayer;
  return { x: s.x, y: s.y, w: s.w, h: s.h };
};
const rect = (o: Partial<ShapeLayer> = {}): ShapeLayer => ({ id: 'pill', kind: 'rect', x: 100, y: 1000, w: 400, h: 100, color: '#000', stroke: 0, fill: '#8B1E2D', curve: 0, radius: 50, rotate: 0, opacity: 1, ...o });
const words = (o: Partial<TextLayer> = {}): TextLayer => ({
  id: 'cta', kind: 'text', text: 'SHOP NOW', x: 140, y: 1030, size: 40, font: 'montserrat-bold', color: '#fff', align: 'left', width: 600, fit: false,
  spacing: 0.1, lineHeight: 1, upper: true, shadow: false, box: null, rotate: 0, opacity: 1, flow: { gap: 20 }, ...o,
});
const doc = (...layers: Layer[]): StoryDoc => ({ bg: { photoId: null, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#000' }, layers, frame: { w: 1080, h: 1350 } });

describe('buttons', () => {
  it('a pill with words on it becomes one text, the pill its background, the words centred where the pill was', () => {
    const r = buttonFromShape(doc(rect(), words(), words({ id: 'other', y: 200 })), 'pill', boxOf, { ink: '#fff' })!;
    expect(r.id).toBe('cta');
    expect(r.doc.layers.map(l => l.id)).toEqual(['cta', 'other']);
    const b = r.doc.layers[0] as TextLayer;
    expect(b.box).toEqual({ color: '#8B1E2D', radius: 50, pad: 0, w: 400, h: 100 });
    expect(b.flow).toBeUndefined();
    expect(boxOf(b)).toEqual({ x: 100, y: 1000, w: 400, h: 100 });   // looks exactly as the pill did
  });

  it('a pill without words gets words to type over, in its place in the stack', () => {
    const r = buttonFromShape(doc(words({ id: 'far', y: 100 }), rect()), 'pill', boxOf, { ink: '#fff', label: 'Book now' })!;
    expect(r.doc.layers.map(l => l.kind)).toEqual(['text', 'text']);
    const b = r.doc.layers[1] as TextLayer;
    expect(b).toMatchObject({ text: 'Book now', align: 'center', x: 300, box: { w: 400, h: 100, color: '#8B1E2D' } });
  });

  it('only a level rectangle; words elsewhere are not taken', () => {
    expect(canBeButton(rect({ rotate: 10 }))).toBe(false);
    expect(wordsOn(doc(rect(), words({ y: 300 })), rect(), boxOf)).toBeNull();
  });

  it('a new button is a set size, its words in the middle', () => {
    const b = newButton({ fill: '#000', ink: '#fff', frame: { w: 1080, h: 1350 } });
    expect(b.box).toMatchObject({ w: 389, h: 92 });
    expect(b.align).toBe('center');
  });
});
