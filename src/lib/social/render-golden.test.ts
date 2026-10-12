import { afterEach, describe, expect, it } from 'vitest';
import { SQUARE_FRAME, renderDoc, type Assets, type Fields, type FontFamilies, type Layer, type StoryDoc } from './editor';
import { makeHarness, type Harness } from './render-harness';
import { NO_ADJUST } from './design';

/**
 * Golden draw logs: documents as they were saved before Designer v2 must keep drawing with exactly the same
 * canvas calls. The stored copy (__snapshots__) was recorded from the renderer before WP1 touched it.
 */
const fonts: FontFamilies = { headline: 'H', body: 'B', serif: 'S', extra: { cormorant: 'C', playfair: 'P', script: 'Sc', montserrat: 'M', cinzel: 'Ci' } };
const fields: Fields = { kicker: 'Rings', headline: 'Emerald halo ring', weight: '21K · 4.2g', details: 'Message us' };
const base = { rotate: 0, opacity: 1 };
const text = (o: Record<string, unknown>) => ({ id: 't', kind: 'text', text: 'Hello gold', x: 100, y: 200, size: 80, font: 'regular', color: '#fff', align: 'left', width: 600, fit: false, spacing: 0, lineHeight: 1.15, upper: false, shadow: false, box: null, ...base, ...o }) as Layer;

const layers: Layer[] = [
  text({ id: 'a', bind: 'headline', font: 'condensed', size: 160, fit: true, flow: { gap: 6 } }),
  text({ id: 'b', text: 'A longer sentence that has to wrap across more than one line of the box', width: 420, y: 500, underline: true, spacing: 0.1, upper: true }),
  text({ id: 'c', text: 'Bent words', curve: 40, align: 'center', x: 540, y: 700 }),
  text({ id: 'd', text: 'Neon', effect: { kind: 'neon', color: '#0ff', offset: 30, angle: 45, blur: 50, thickness: 40, transparency: 50 }, y: 800 }),
  text({ id: 'e', text: 'Boxed', box: { color: '#111', radius: 20, pad: 20 }, shadow: true, y: 900, autoColor: true, rotate: 8, opacity: 0.8 }),
  { id: 'm', kind: 'wordmark', mark: 'wordmark', x: 700, y: 100, width: 300, color: '#fff', autoColor: true, ...base },
  { id: 'r', kind: 'rect', x: 80, y: 1000, w: 300, h: 160, color: '#f00', stroke: 6, fill: '#ff0', fill2: '#0f0', curve: 0, radius: 24, dash: 'dash', ...base },
  { id: 's', kind: 'shape', shape: 'star', x: 500, y: 1000, w: 200, h: 200, color: '#fff', stroke: 0, fill: '#c9973f', curve: 0, radius: 0, flipX: true, ...base },
  { id: 'c1', kind: 'circle', x: 760, y: 1000, w: 200, h: 200, color: '#fff', stroke: 4, fill: null, curve: 0, radius: 0, ...base },
  { id: 'ar', kind: 'arrow', x: 700, y: 1300, w: -170, h: 170, color: '#fff', stroke: 7, fill: null, curve: 40, radius: 0, ...base },
  { id: 'ln', kind: 'line', x: 100, y: 1300, w: 400, h: 0, color: '#fff', stroke: 10, fill: null, curve: 0, radius: 0, dash: 'dot', ...base },
  { id: 'i1', kind: 'image', photoId: 'p1', x: 600, y: 1250, w: 380, radius: 24, border: '#fff', shadow: true, ...base },
  { id: 'i2', kind: 'image', photoId: 'p1', x: 80, y: 1400, w: 420, h: 300, fx: 0.3, fy: 0.6, iz: 1.5, radius: 0, border: null, shadow: false, mask: 'arch', adjust: { ...NO_ADJUST, warmth: 30, vignette: 40 }, shade: { from: '#000', fromAlpha: 0, to: '#000', toAlpha: 0.6, angle: 180, start: 0.4, end: 1 }, ...base, rotate: 5 },
  { id: 'i3', kind: 'image', photoId: 'p1', x: 550, y: 1600, w: 300, radius: 10, border: null, shadow: true, mask: 'heart', flipY: true, ...base },
];

let h: Harness | undefined;
afterEach(() => h?.restore());

function draw(doc: StoryDoc): string {
  h = makeHarness();
  const photo = h.image('p1', 600, 400);
  const mark = h.image('wordmark', 400, 100);
  const a: Assets = { photos: { p1: photo }, marks: { wordmark: mark }, fonts };
  renderDoc(h.ctx, doc, fields, a);
  return h.log.join('\n');
}

describe('existing documents draw as they always did', () => {
  it('a story with every kind of layer', () => {
    const doc: StoryDoc = { bg: { photoId: 'p1', placement: { mode: 'fill', zoom: 1.2, focusX: 0.3, focusY: 0.5 }, dim: 0.2, gradient: 'both', color: '#222', shade: { from: '#000', fromAlpha: 0.1, to: '#123456', toAlpha: 0.5, angle: 90, start: 0.2, end: 0.9 }, color2: '#445566', adjust: { ...NO_ADJUST, brightness: 10, saturation: -20, vignette: 30 } }, layers };
    expect(draw(doc)).toMatchSnapshot();
  });
  it('a square with a fitted photo and no layers', () => {
    const doc: StoryDoc = { bg: { photoId: 'p1', placement: { mode: 'fit', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#EDE6DA' }, layers: [], frame: SQUARE_FRAME, placements: {} };
    expect(draw(doc)).toMatchSnapshot();
  });
  it('a plain colour design', () => {
    const doc: StoryDoc = { bg: { photoId: null, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#EDE6DA' }, layers: layers.slice(0, 5) };
    expect(draw(doc)).toMatchSnapshot();
  });
});
