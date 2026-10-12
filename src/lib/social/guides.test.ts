import { describe, expect, it } from 'vitest';
import {
  addGuide, clampGrid, cycleLayer, describeChange, fitToUnion, framePos, guidesOf, hasGuides, marginBox, matchTo, moveGuide, nextZoom, niceStep, removeGuide,
  rulerTicks, sizeWith, withGrid, withGuides, MAX_GUIDES, autoSafeKind,
} from './guides';
import type { StoryDoc, TextLayer } from './editor';

const F = { w: 1080, h: 1920 };
const doc = (layers: StoryDoc['layers'] = [], extra: Partial<StoryDoc> = {}): StoryDoc =>
  ({ bg: { photoId: null, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#000000' }, layers, ...extra }) as StoryDoc;
const text = (id: string, p: Partial<TextLayer> = {}): TextLayer =>
  ({ id, kind: 'text', text: 'Hi', x: 100, y: 100, size: 60, font: 'regular', color: '#fff', align: 'left', width: 500, fit: false, spacing: 0, lineHeight: 1.1, upper: false, shadow: false, box: null, rotate: 0, opacity: 1, ...p });

describe('guides', () => {
  it('keeps guides whole, sorted, unique and inside the frame', () => {
    const g = guidesOf({ guides: { x: [500.4, 100, 100, -5, 2000, NaN], y: [10] } }, F);
    expect(g).toEqual({ x: [100, 500], y: [10] });
    expect(guidesOf(undefined, F)).toEqual({ x: [], y: [] });
  });
  it('adds, moves, removes; a guide dragged outside is deleted', () => {
    let g = addGuide({ x: [], y: [] }, 'x', 300.2, F);
    g = addGuide(g, 'y', 900, F);
    expect(g).toEqual({ x: [300], y: [900] });
    expect(addGuide(g, 'x', 5000, F)).toBe(g);
    expect(moveGuide(g, 'x', 0, 640, F).x).toEqual([640]);
    expect(moveGuide(g, 'x', 0, -20, F).x).toEqual([]);
    expect(removeGuide(g, 'y', 0).y).toEqual([]);
  });
  it('caps the number of guides', () => {
    let g = { x: [] as number[], y: [] as number[] };
    for (let i = 1; i < 100; i++) g = addGuide(g, 'x', i * 10, { w: 2000, h: 100 });
    expect(g.x.length).toBe(MAX_GUIDES);
  });
  it('writes guides and the grid into meta, and leaves plain designs plain', () => {
    const m = withGuides(undefined, { x: [100], y: [] });
    expect(m).toEqual({ guides: { x: [100], y: [] } });
    expect(withGuides(m, { x: [], y: [] })).toBeUndefined();
    expect(withGrid({ subject: { x: 0, y: 0, w: 1, h: 1 } }, 40)).toEqual({ subject: { x: 0, y: 0, w: 1, h: 1 }, grid: 40 });
    expect(withGrid({ grid: 40 }, 0)).toBeUndefined();
    expect(hasGuides({ x: [], y: [] })).toBe(false);
    expect(clampGrid(2)).toBe(0);
    expect(clampGrid(500)).toBe(400);
  });
  it('draws the margin view inside the page', () => {
    expect(marginBox(F, 96)).toEqual({ x: 96, y: 96, w: 888, h: 1728 });
    expect(marginBox({ w: 100, h: 100 }, 80).w).toBe(0);
  });
});

describe('rulers', () => {
  it('picks 1-2-5 steps that never crowd', () => {
    expect(niceStep(0.5)).toBe(200);
    expect(niceStep(1)).toBe(100);
    expect(niceStep(0.25)).toBe(500);
    expect(niceStep(4)).toBe(20);
  });
  it('labels the majors and stays bounded', () => {
    const t = rulerTicks(1080, 0.5);
    expect(t[0]).toEqual({ at: 0, major: true, label: '0' });
    expect(t.filter(x => x.major).map(x => x.label)).toEqual(['0', '200', '400', '600', '800', '1000']);
    expect(rulerTicks(1e9, 0.01).length).toBeLessThanOrEqual(401);
  });
  it('turns a pointer into frame pixels', () => {
    expect(framePos(150, 50, 500, 1080)).toBe(216);
  });
});

describe('safe zones', () => {
  it('picks the view that fits the page', () => {
    expect(autoSafeKind({ w: 1080, h: 1920 })).toBe('story');
    expect(autoSafeKind({ w: 1080, h: 1350 })).toBe('feed-grid');
    expect(autoSafeKind({ w: 1080, h: 1080 })).toBe('feed-grid');
    expect(autoSafeKind({ w: 1200, h: 628 })).toBe('link');
  });
});

describe('keyboard', () => {
  const ls = [{ id: 'a' }, { id: 'b', hidden: true }, { id: 'c', locked: true }, { id: 'd' }];
  it('Tab skips hidden and locked layers and wraps', () => {
    expect(cycleLayer(ls, [])).toBe('a');
    expect(cycleLayer(ls, ['a'])).toBe('d');
    expect(cycleLayer(ls, ['d'])).toBe('a');
    expect(cycleLayer(ls, ['a'], true)).toBe('d');
    expect(cycleLayer(ls, [], true)).toBe('d');
    expect(cycleLayer([{ id: 'x', hidden: true }], [])).toBeNull();
  });
  it('zooms through the levels', () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(3, 1)).toBe(3);
    expect(nextZoom(0.1, -1)).toBe(0.1);
  });
});

describe('position numbers', () => {
  it('locks the aspect when asked', () => {
    expect(sizeWith({ w: 400, h: 200 }, { w: 600 }, true)).toEqual({ w: 600, h: 300 });
    expect(sizeWith({ w: 400, h: 200 }, { h: 100 }, true)).toEqual({ w: 200, h: 100 });
    expect(sizeWith({ w: 400, h: 200 }, { w: 600 }, false)).toEqual({ w: 600, h: 200 });
    expect(sizeWith({ w: 0, h: 0 }, { w: 10 }, true).w).toBe(10);
  });
  it('sizes a selection as one thing', () => {
    const boxes = [{ x: 100, y: 100, w: 100, h: 100 }, { x: 300, y: 100, w: 100, h: 200 }];
    const union = { x: 100, y: 100, w: 300, h: 200 };
    expect(fitToUnion(boxes, union, { w: 600 })).toEqual([{ x: 100, y: 100, w: 200, h: 100 }, { x: 500, y: 100, w: 200, h: 200 }]);
    expect(fitToUnion(boxes, union, { x: 0, y: 0 })[1]).toEqual({ x: 200, y: 0, w: 100, h: 200 });
  });
  it('matches size and position to the first', () => {
    const ref = { x: 10, y: 20, w: 200, h: 100 };
    const b = { x: 50, y: 60, w: 100, h: 100 };
    expect(matchTo(ref, [b], 'width')).toEqual([{ dx: 0, dy: 0, kx: 2, ky: 1 }]);
    expect(matchTo(ref, [b], 'both')[0]).toMatchObject({ kx: 2, ky: 1 });
    expect(matchTo(ref, [b], 'position')).toEqual([{ dx: -40, dy: -40, kx: 1, ky: 1 }]);
    expect(matchTo(ref, [b], 'x')[0].dy).toBe(0);
  });
});

describe('history labels', () => {
  const a = text('a', { name: 'Headline' }), b = text('b');
  it('names what changed', () => {
    expect(describeChange(doc([a]), doc([a, b]))).toBe('Added text');
    expect(describeChange(doc([a, b]), doc([a]))).toBe('Deleted text');
    expect(describeChange(doc([a, b]), doc([]))).toBe('Deleted 2 things');
    expect(describeChange(doc([a]), doc([{ ...a, x: 200 }]))).toBe('Moved Headline');
    expect(describeChange(doc([a]), doc([{ ...a, color: '#000' }]))).toBe('Colour Headline');
    expect(describeChange(doc([a, b]), doc([{ ...a, x: 1 }, { ...b, x: 2 }]))).toBe('Moved, 2 things');
    expect(describeChange(doc([a, b]), doc([b, a]))).toBe('Reordered layers');
    expect(describeChange(doc([a]), doc([{ ...a, hidden: true }]))).toBe('Shown or hidden: Headline');
  });
  it('names the document-level changes', () => {
    expect(describeChange(doc([]), doc([], { bg: { ...doc().bg, color: '#fff' } }))).toBe('Background colour');
    expect(describeChange(doc([]), doc([], { bg: { ...doc().bg, adjust: { brightness: 5, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0 } } }))).toBe('Photo adjust');
    expect(describeChange(doc([]), doc([], { bg: { ...doc().bg, dim: 0.3 } }))).toBe('Shade over the photo');
    expect(describeChange(doc([]), doc([], { meta: { guides: { x: [1], y: [] } } }))).toBe('Guides');
    expect(describeChange(doc([]), doc([], { meta: { grid: 40 } }))).toBe('Grid');
  });
});
