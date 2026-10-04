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
