import { describe, expect, it } from 'vitest';
import { SQUARE_FRAME, carryLayers, emptyDoc, emptySquare, layerBox, type Assets, type Fields, type MarkLayer, type ShapeLayer } from './editor';
import { STORY_FRAME } from './story';

const fields: Fields = { kicker: '', headline: 'Bangle', weight: '18.8g', details: '' };
const assets: Assets = { photos: {}, marks: {}, fonts: {} as Assets['fonts'] };
const box = (over: Partial<ShapeLayer> = {}): ShapeLayer => ({
  id: 'rect-1', kind: 'rect', rotate: 0, opacity: 1, x: 440, y: 1400, w: 200, h: 120, color: '#fff', stroke: 6, fill: null, curve: 0, radius: 0, ...over,
});
const centre = (l: Parameters<typeof layerBox>[0]) => { const b = layerBox(l, fields, assets); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };

describe('carrying layers between the story and the square', () => {
  it('keeps a layer at the same place on the page, smaller on the square', () => {
    const [l] = carryLayers([box()], STORY_FRAME, emptySquare(), fields, assets) as ShapeLayer[];
    const was = centre(box());
    const now = centre(l);
    expect(now.x).toBeCloseTo((was.x / STORY_FRAME.w) * SQUARE_FRAME.w, 0);
    expect(now.y).toBeCloseTo((was.y / STORY_FRAME.h) * SQUARE_FRAME.h, 0);
    expect(l.w).toBe(150); // × 0.75: the square has 9/16 of the story's area
    expect(l.h).toBe(90);
  });

  it('never grows a layer going to the taller story', () => {
    const [l] = carryLayers([box({ y: 500 })], SQUARE_FRAME, emptyDoc(null), fields, assets) as ShapeLayer[];
    expect(l.w).toBe(200);
    expect(centre(l).y).toBeCloseTo((560 / SQUARE_FRAME.h) * STORY_FRAME.h, 0);
  });

  it('gives new ids and new group ids, kept together, and unlocks', () => {
    const a = box({ id: 'a', group: 'g1', locked: true });
    const b = box({ id: 'b', group: 'g1', x: 100 });
    const out = carryLayers([a, b], STORY_FRAME, emptySquare(), fields, assets);
    expect(out.map(l => l.id)).not.toContain('a');
    expect(out[0].group).toBe(out[1].group);
    expect(out[0].group).not.toBe('g1');
    expect(out[0].locked).toBe(false);
  });

  it('carries the marks too, sized like everything else', () => {
    const mark: MarkLayer = { id: 'm', kind: 'wordmark', mark: 'wordmark', x: 800, y: 96, width: 200, color: '#fff', autoColor: false, rotate: 0, opacity: 1 };
    const [m] = carryLayers([mark], STORY_FRAME, emptySquare(), fields, assets) as MarkLayer[];
    expect(m.kind).toBe('wordmark');
    expect(m.width).toBe(150);
    expect(m.color).toBe('#fff');
  });
});
