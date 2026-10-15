import { describe, expect, it } from 'vitest';
import type { StoryDoc, TextLayer } from '@/lib/social/editor';
import { applyOps, type Board, type BoardFrame } from './board-shape';
import { linkKey, linkedChanges, linkedCount, toggleLink } from './board-links';

const text = (id: string, t: string, o: Partial<TextLayer> = {}): TextLayer => ({
  id, kind: 'text', text: t, x: 100, y: 200, size: 80, font: 'serif', color: '#111111', align: 'left', width: 800, fit: false,
  spacing: 0, lineHeight: 1.1, upper: false, shadow: false, box: null, rotate: 0, opacity: 1, ...o,
});
const doc = (h: number, ...layers: TextLayer[]): StoryDoc => ({
  bg: { photoId: null, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#000' },
  layers, frame: { w: 1080, h },
});
const frame = (id: string, format: BoardFrame['format'], d: StoryDoc | null, o: Partial<BoardFrame> = {}): BoardFrame => ({
  id, x: 0, y: 0, label: id, format, assetId: null, marked: false, template: 'headline',
  fields: { kicker: '', headline: 'Mira', weight: '', details: '' }, doc: d, by: 'page', rev: 1, group: 'g', ...o,
});
const board = (...frames: BoardFrame[]): Board => ({ id: 'b', name: 'b', frames, notes: [], rev: 1, updated: '', by: 'x' });
const layer = (b: Board, f: string, l: string) => b.frames.find(x => x.id === f)!.doc!.layers.find(x => x.id === l) as TextLayer;

describe('board-links', () => {
  const p = frame('p', 'portrait', doc(1350, text('h', 'More Fire', { link: 'k1' }), text('c', 'SHOP NOW', { link: 'k2', y: 1200 })));
  const s = frame('s', 'story', doc(1920, text('h2', 'More Fire', { link: 'k1', size: 120, y: 600, align: 'center' }), text('c2', 'SHOP NOW', { link: 'k2', y: 1500 })));

  it('carries the words and style to the other size, keeping its place, width and align', () => {
    const after = { ...p, doc: { ...p.doc!, layers: p.doc!.layers.map(l => (l.id === 'h' ? { ...l, text: 'More Fire Than Diamond', color: '#C9A', font: 'cormorant' as const, x: 5 } : l)) } };
    const [ch] = linkedChanges(p, after, [s]);
    const h2 = ch.doc!.layers[0] as TextLayer;
    expect(h2).toMatchObject({ text: 'More Fire Than Diamond', color: '#C9A', font: 'cormorant', x: 100, y: 600, align: 'center', size: 120 });
    expect(ch.doc!.layers[1]).toBe(s.doc!.layers[1]);   // untouched
  });

  it('scales the size by the same ratio, so each size keeps its own scale', () => {
    const after = { ...p, doc: { ...p.doc!, layers: p.doc!.layers.map(l => (l.id === 'h' ? { ...l, size: 100 } : l)) } };
    expect((linkedChanges(p, after, [s])[0].doc!.layers[0] as TextLayer).size).toBe(150);
  });

  it('a button changed in one size keeps its own scale in the other', () => {
    const a = frame('a', 'portrait', doc(1350, text('b1', 'SHOP NOW', { link: 'kb', size: 34, box: { color: '#8B1E2D', radius: 48, pad: 33, w: 315, h: 101 } })));
    const b = frame('b', 'story', doc(1920, text('b2', 'SHOP NOW', { link: 'kb', size: 68, box: { color: '#8B1E2D', radius: 96, pad: 66, w: 630, h: 202 } })));
    const after = { ...a, doc: { ...a.doc!, layers: [{ ...a.doc!.layers[0], box: { color: '#000000', radius: 48, pad: 33, w: 330, h: 101 } }] } };
    expect((linkedChanges(a, after, [b])[0].doc!.layers[0] as TextLayer).box).toEqual({ color: '#000000', radius: 96, pad: 66, w: 660, h: 202 });
  });

  it('carries only what changed, so a tweak made in one size alone survives', () => {
    const tuned = { ...s, doc: { ...s.doc!, layers: s.doc!.layers.map(l => (l.id === 'h2' ? { ...l, color: '#FFFFFF' } : l)) } };
    const after = { ...p, doc: { ...p.doc!, layers: p.doc!.layers.map(l => (l.id === 'h' ? { ...l, text: 'New' } : l)) } };
    expect(linkedChanges(p, after, [tuned])[0].doc!.layers[0]).toMatchObject({ text: 'New', color: '#FFFFFF' });
  });

  it('leaves an unlinked text alone, both ways', () => {
    const freed = { ...s, doc: { ...s.doc!, layers: s.doc!.layers.map(l => (l.id === 'h2' ? toggleLink(l) : l)) } };
    expect(linkKey(freed.doc!.layers[0])).toBeNull();
    const after = { ...p, doc: { ...p.doc!, layers: p.doc!.layers.map(l => (l.id === 'h' ? { ...l, text: 'New' } : l)) } };
    expect(linkedChanges(p, after, [freed])).toEqual([]);
    const after2 = { ...freed, doc: { ...freed.doc!, layers: freed.doc!.layers.map(l => (l.id === 'h2' ? { ...l, text: 'Only here' } : l)) } };
    expect(linkedChanges(freed, after2, [p])).toEqual([]);
  });

  it('linking again finds the same twin by its kept key and makes it match', () => {
    const freed = toggleLink(p.doc!.layers[0]);
    const before = { ...p, doc: { ...p.doc!, layers: [{ ...freed, text: 'Changed alone' }, p.doc!.layers[1]] } };
    const after = { ...before, doc: { ...before.doc!, layers: [toggleLink(before.doc!.layers[0]), before.doc!.layers[1]] } };
    expect(linkKey(after.doc!.layers[0])).toBe('k1');
    const [ch] = linkedChanges(before, after, [s]);
    expect(ch.doc!.layers).toHaveLength(2);
    expect(ch.doc!.layers[0]).toMatchObject({ id: 'h2', text: 'Changed alone', size: 120 });
  });

  it('a newly linked text claims the same words in the other size, else is copied there in proportion', () => {
    const a = frame('a', 'portrait', doc(1350, text('x', 'Made to Your Size', { y: 675 }), text('y', 'Only here', { y: 1000 })));
    const b = frame('b', 'story', doc(1920, text('x2', 'made to  your size', { size: 90 })));
    const after = { ...a, doc: { ...a.doc!, layers: a.doc!.layers.map(toggleLink) } };
    const [ch] = linkedChanges(a, after, [b]);
    expect(ch.doc!.layers[0]).toMatchObject({ id: 'x2', text: 'Made to Your Size', size: 90, link: linkKey(after.doc!.layers[0]) });
    const copy = ch.doc!.layers[1] as TextLayer;
    expect(copy).toMatchObject({ text: 'Only here', y: 1422.22, link: linkKey(after.doc!.layers[1]) });
    expect(linkedCount([{ doc: ch.doc! }], after.doc!.layers[1])).toBe(1);
  });

  it('a bound text is linked by its field; field changes go to the other sizes', () => {
    const a = frame('a', 'portrait', doc(1350, text('hb', '', { bind: 'headline' })));
    const b = frame('b', 'story', doc(1920, text('hb2', '', { bind: 'headline' })));
    const after = { ...a, fields: { ...a.fields, headline: 'Leah' } };
    expect(linkedChanges(a, after, [b])).toEqual([{ id: 'b', fields: { ...b.fields, headline: 'Leah' } }]);
    const freed = { ...b, doc: { ...b.doc!, layers: b.doc!.layers.map(toggleLink) } };
    expect(linkedChanges(a, after, [freed])).toEqual([]);
  });

  it('applyOps puts the change on every size, bumps their revs and says which', () => {
    const q = frame('q', 'r3x4', doc(1440, text('h3', 'More Fire', { link: 'k1' })));
    const other = frame('o', 'portrait', doc(1350, text('h', 'More Fire', { link: 'k1' })), { group: 'other' });
    const nd = { ...p.doc!, layers: p.doc!.layers.map(l => (l.id === 'h' ? { ...l, text: 'Blaze' } : l)) };
    const { board: out, linked } = applyOps(board(p, s, q, other), [{ op: 'put', id: 'p', patch: { doc: nd } }]);
    expect(linked.sort()).toEqual(['q', 's']);
    expect(layer(out, 's', 'h2').text).toBe('Blaze');
    expect(layer(out, 'q', 'h3').text).toBe('Blaze');
    expect(layer(out, 'o', 'h').text).toBe('More Fire');
    expect(out.frames.find(f => f.id === 's')!.rev).toBe(2);
    expect(out.frames.find(f => f.id === 'p')!.group).toBe('g');
  });

  it('a layout with an undefined key saves (the resizer leaves flow: undefined)', () => {
    const d = { ...p.doc!, layers: [{ ...p.doc!.layers[0], flow: undefined }] };
    const { board: out } = applyOps(board(p, s), [{ op: 'put', id: 'p', quiet: true, patch: { doc: d } }]);
    expect('flow' in out.frames[0].doc!.layers[0]).toBe(false);
  });

  it('a group of null takes a design out of its sizes', () => {
    const { board: out } = applyOps(board(p, s), [{ op: 'put', id: 'p', patch: { group: null as unknown as string } }]);
    expect(out.frames.find(f => f.id === 'p')!.group).toBeUndefined();
  });
});
