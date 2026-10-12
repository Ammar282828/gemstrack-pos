import { describe, expect, it } from 'vitest';
import { blankAd } from '@/lib/ads/studio/templates';
import type { StoryDoc } from '@/lib/social/editor';
import {
  activePage, addPages, deserializeWork, editDoc, fromRecord, layOutAll, newWork, photoPartOf, redoFromMaster, removePage, sectionOf, sectionsFor,
  serializeWork, setActive, setDoc, setMaster, toInput, toRecordLike, KIND_CARDS, pageOf, type DesignWork,
} from './design-state';

const edited = (d: StoryDoc): StoryDoc => ({ ...d, layers: [...d.layers] });
const piece = (): DesignWork => newWork({ kind: 'piece', sizes: [{ id: 'story' }, { id: 'whatsapp' }, { id: 'portrait' }] });

describe('a new design', () => {
  it('has the kind’s sizes, the first as master, the rest made from it', () => {
    const w = piece();
    expect(w.pages.map(p => p.format)).toEqual(['story', 'square', 'portrait']);
    expect(w.pages.map(p => p.origin)).toEqual(['master', 'resized', 'resized']);
    expect(w.pages[1].syncedFrom).toBe(w.master);
    expect(w.active).toBe(w.master);
    expect(w.fresh).toBe(true);
    expect(w.dirty).toBe(false);
  });
  it('falls back to the kind’s own sizes, and an ad is the ads’', () => {
    const w = newWork({ kind: 'ad', sizes: [] });
    expect(w.pages).toHaveLength(1);
    expect(w.pages[0].format).toBe('portrait');
    expect(w.scope).toBe('ads');
    expect(newWork({ kind: 'post', sizes: [] }).scope).toBe('shop');
  });
  it('takes a custom W:H', () => {
    const w = newWork({ kind: 'custom', sizes: [{ id: 'custom', custom: { w: 3, h: 1 } }] });
    expect(w.pages[0].format).toBe('custom');
    expect(w.pages[0].frame.w / w.pages[0].frame.h).toBeCloseTo(3, 0);
  });
  it('every kind card names sizes that exist', () => {
    for (const c of KIND_CARDS) expect(newWork({ kind: c.kind, sizes: [] }).pages.length).toBe(c.sizes.length);
  });
});

describe('laying out', () => {
  it('sets every page’s document, bumps ver, and is not a change', () => {
    const w = layOutAll(piece(), p => edited(p.doc));
    expect(w.fresh).toBe(false);
    expect(w.dirty).toBe(false);
    expect(w.pages.every(p => p.ver === 1)).toBe(true);
  });
  it('is a change once the design has been made', () => {
    const w = layOutAll(layOutAll(piece(), p => p.doc), p => p.doc, 'rate');
    expect(w.dirty).toBe(true);
    expect(w.template).toBe('rate');
  });
});

describe('editing', () => {
  it('editing the master marks the pages resized from it as stale', () => {
    const w0 = piece();
    const w = editDoc(w0, w0.master, edited(w0.pages[0].doc));
    expect(w.stale.sort()).toEqual([w0.pages[1].id, w0.pages[2].id].sort());
    expect(w.pages[0].rev).toBe(1);
    expect(w.pages[0].origin).toBe('master');
    expect(w.dirty).toBe(true);
  });
  it('editing a resized page makes it the person’s own and clears its stale flag', () => {
    const w0 = piece();
    const w1 = editDoc(w0, w0.master, edited(w0.pages[0].doc));
    const id = w0.pages[1].id;
    const w = editDoc(w1, id, edited(w0.pages[1].doc));
    expect(pageOf(w, id)!.origin).toBe('manual');
    expect(w.stale).not.toContain(id);
    // …and a later master edit leaves it alone.
    const w2 = editDoc(w, w.master, edited(w.pages[0].doc));
    expect(w2.stale).toEqual([w0.pages[2].id]);
  });
  it('the same document is no change', () => {
    const w = piece();
    expect(editDoc(w, w.master, w.pages[0].doc)).toBe(w);
    expect(editDoc(w, 'nope', blankAd('square'))).toBe(w);
  });
  it('a document set from outside bumps ver, so the editor starts over', () => {
    const w0 = piece();
    const w = setDoc(w0, w0.master, edited(w0.pages[0].doc));
    expect(w.pages[0].ver).toBe(w0.pages[0].ver + 1);
  });
  it('re-doing from the master puts the page back in step', () => {
    const w0 = piece();
    const id = w0.pages[1].id;
    const manual = editDoc(editDoc(w0, w0.master, edited(w0.pages[0].doc)), id, edited(w0.pages[1].doc));
    const w = redoFromMaster(manual, id, blankAd('square'));
    expect(pageOf(w, id)).toMatchObject({ origin: 'resized', syncedFrom: w0.master });
    expect(w.stale).not.toContain(id);
  });
});

describe('pages', () => {
  it('adds resized pages from the master with new ids, and shows the last', () => {
    const w0 = newWork({ kind: 'post', sizes: [{ id: 'square' }] });
    const w = addPages(w0, [
      { id: w0.master, label: 'Story', format: 'story', frame: { w: 1080, h: 1920 }, doc: blankAd('story') },
      { label: 'Link', format: 'landscape', frame: { w: 1200, h: 565 }, doc: blankAd('landscape') },
    ]);
    expect(new Set(w.pages.map(p => p.id)).size).toBe(3);
    expect(w.pages[1].origin).toBe('resized');
    expect(w.pages[1].syncedFrom).toBe(w0.master);
    expect(w.active).toBe(w.pages[2].id);
    expect(addPages(w0, [])).toBe(w0);
  });
  it('never more than 24', () => {
    let w = piece();
    for (let i = 0; i < 30; i++) w = addPages(w, [{ label: 'x', format: 'square', frame: { w: 1080, h: 1080 }, doc: blankAd('square') }]);
    expect(w.pages).toHaveLength(24);
  });
  it('removes a page, keeps the last one, and moves the master on when it goes', () => {
    const w0 = piece();
    const w = removePage(w0, w0.master);
    expect(w.pages).toHaveLength(2);
    expect(w.master).toBe(w0.pages[1].id);
    expect(w.active).toBe(w.master);
    expect(pageOf(w, w.master)!.origin).toBe('master');
    // The page that followed the old master now stands on its own.
    expect(pageOf(w, w0.pages[2].id)).toMatchObject({ origin: 'manual' });
    expect(removePage(newWork({ kind: 'post', sizes: [] }), 'p1').pages).toHaveLength(1);
  });
  it('a new master: the pages that followed the old one follow it and are behind', () => {
    const w0 = piece();
    const w = setMaster(w0, w0.pages[1].id);
    expect(w.master).toBe(w0.pages[1].id);
    expect(pageOf(w, w0.pages[0].id)!.origin).toBe('manual');
    expect(pageOf(w, w0.pages[2].id)).toMatchObject({ origin: 'resized', syncedFrom: w0.pages[1].id });
    expect(w.stale).toEqual([w0.pages[2].id]);
    expect(setMaster(w, w.master)).toBe(w);
  });
  it('the active page can be switched, to a page that exists', () => {
    const w = piece();
    expect(activePage(setActive(w, w.pages[1].id)).id).toBe(w.pages[1].id);
    expect(setActive(w, 'nope')).toBe(w);
  });
});

describe('records and drafts', () => {
  it('a record made from the work passes the server’s cleaner', () => {
    const w = newWork({ kind: 'piece', sizes: [{ id: 'story' }, { id: 'whatsapp' }], fields: { headline: 'Ruby ring' } });
    const input = toInput(w, '');
    expect(input).not.toBeNull();
    expect(input!.name).toBe('Ruby ring');
    expect(input!.pages.map(p => p.format)).toEqual(['story', 'square']);
    expect(input!.master).toBe(w.master);
  });
  it('an ad is saved in the ads’ scope', () => {
    expect(toInput(newWork({ kind: 'ad', sizes: [] }), '')!.scope).toBe('ads');
  });
  it('opens a saved design with its documents, and not without them', () => {
    const w = newWork({ kind: 'piece', sizes: [{ id: 'story' }, { id: 'whatsapp' }] });
    const rec = toRecordLike(w, 'a@b.c');
    const docs = Object.fromEntries(w.pages.map(p => [p.id, p.doc]));
    const back = fromRecord({ ...rec, id: 'd1' }, docs);
    expect(back).toMatchObject({ id: 'd1', fresh: false, dirty: false, master: w.master });
    expect(back!.pages).toHaveLength(2);
    expect(fromRecord({ ...rec, id: 'd1' }, { [w.master]: w.pages[0].doc })).toBeNull();
  });
  it('a device draft round-trips through JSON', () => {
    const w = layOutAll(piece(), p => p.doc);
    const back = deserializeWork(JSON.parse(JSON.stringify(serializeWork(w))));
    expect(back).toMatchObject({ kind: 'piece', master: w.master, fresh: false });
    expect(back!.pages.map(p => p.id)).toEqual(w.pages.map(p => p.id));
  });
  it('refuses a draft that is not a design’s', () => {
    expect(deserializeWork({ photos: [] })).toBeNull();
    expect(deserializeWork({ design: 1, work: { pages: [] } })).toBeNull();
    expect(deserializeWork(null)).toBeNull();
  });
});

describe('sections by role', () => {
  it('staff do not see the Board or the library', () => {
    expect(sectionsFor(false).map(s => s.key)).toEqual(['make', 'photos', 'saved']);
    expect(sectionsFor(true).map(s => s.key)).toEqual(['make', 'photos', 'board', 'saved']);
    expect(sectionOf('board', false)).toBe('make');
    expect(sectionOf('board', true)).toBe('board');
    expect(sectionOf(null, true)).toBe('make');
    expect(photoPartOf('library', false)).toBe('site');
    expect(photoPartOf('library', true)).toBe('library');
  });
});
