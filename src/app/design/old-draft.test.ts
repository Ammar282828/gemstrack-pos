import { describe, expect, it } from 'vitest';
import { PHOTO, blankAd } from '@/lib/ads/studio/templates';
import { letteredOf } from '@/lib/design/lettered';
import type { PostDraft } from '@/lib/social/post-drafts';
import { SQUARE_FRAME, type StoryDoc, type TextLayer } from '@/lib/social/editor';
import { convertOldDraft, isOldPostDraft, remapDoc, type OldDraftState } from './old-draft';
import { isDesignDraft, serializeWork } from './design-state';

const text = (id: string, bind: TextLayer['bind']): TextLayer => ({ id, kind: 'text', bind, x: 0, y: 0, size: 40, font: 'regular', color: '#fff', align: 'left', rotate: 0, opacity: 1 } as unknown as TextLayer);
const story = (photoId: string): StoryDoc => ({ ...blankAd('story'), bg: { ...blankAd('story').bg, photoId }, layers: [text('h', 'headline'), text('w', 'weight')] });
const square = (photoId: string): StoryDoc => ({ ...blankAd('square'), frame: SQUARE_FRAME, bg: { ...blankAd('square').bg, photoId }, placements: { 'a-1': { mode: 'fill', zoom: 1, focusX: 0, focusY: 0 }, 'b-2': { mode: 'fill', zoom: 2, focusX: 1, focusY: 1 } } });
const blob = (s: string) => new Blob([s]);

function draft(over: Partial<OldDraftState> = {}, extra: Partial<PostDraft<OldDraftState>> = {}): PostDraft<OldDraftState> {
  return {
    id: 'post-1', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', title: 'Bangle & Ring',
    photos: [{ id: 'a-1', name: 'a.jpg', toSite: true, toWhatsApp: true }, { id: 'b-2', name: 'b.jpg', toSite: true, toWhatsApp: true }],
    state: { headline: 'Bangle & Ring', kicker: 'Lightweight', weight: '18.8', metal: '21K Yellow Gold', stones: 'Rubies', story: story('a-1'), square: square('b-2'), caption: 'Hello', formats: 'both', folder: 'Rings/Rings', ...over },
    ...extra,
  };
}
const blobs = () => new Map([['a-1', blob('a')], ['b-2', blob('b')]]);

describe('an old Post a piece draft', () => {
  it('is told from a Design draft', () => {
    expect(isOldPostDraft(draft().state)).toBe(true);
    expect(isDesignDraft(draft().state)).toBe(false);
  });
  it('opens as a piece: the story is the master, the square the WhatsApp page, the lead photograph the design’s own', () => {
    const o = convertOldDraft(draft(), blobs())!;
    expect(o.work.kind).toBe('piece');
    expect(o.work.pages.map(p => p.format)).toEqual(['story', 'square']);
    expect(o.work.master).toBe(o.work.pages[0].id);
    expect(o.work.fresh).toBe(false);
    expect(o.work.pages[0].doc.bg.photoId).toBe(PHOTO);
    // The square showed another photograph: it keeps it, under a new id, with its crop.
    const second = o.work.pages[1].doc.bg.photoId!;
    expect(second).not.toBe(PHOTO);
    expect(o.more.has(second)).toBe(true);
    expect(o.work.pages[1].doc.placements?.[second]?.zoom).toBe(2);
    expect(o.main?.label).toBe('a.jpg');
  });
  it('keeps the words: fields from the piece, the caption for the Publish sheet, the collection for it too', () => {
    const o = convertOldDraft(draft({ aiCaption: { instagramCaption: 'IG!' } }), blobs())!;
    expect(o.work.fields).toMatchObject({ headline: 'Bangle & Ring', kicker: 'Lightweight', weight: '18.8g' });
    expect(o.work.fields.details).toBe('21K Yellow Gold | Rubies');
    expect(o.work.copy).toEqual({ wa: 'Hello', ig: 'IG!' });
    expect(o.folder).toBe('Rings/Rings');
    expect(o.work.name).toBe('Bangle & Ring');
  });
  it('a story-only or post-only draft opens as just that', () => {
    expect(convertOldDraft(draft({ formats: 'story' }), blobs())!.work.pages.map(p => p.format)).toEqual(['story']);
    const sq = convertOldDraft(draft({ formats: 'square', story: undefined }), blobs())!;
    expect(sq.work.kind).toBe('whatsapp');
    expect(sq.work.pages.map(p => p.format)).toEqual(['square']);
  });
  it('puts an AI lettering that was on back on the story, and goes back to the design’s words', () => {
    const d = draft({ lettering: 'ai' }, { lettered: { verified: true, missing: [], forId: 'a-1', kind: 'letter' } });
    const o = convertOldDraft(d, new Map([...blobs(), ['lettered', blob('L')]]))!;
    const page = o.work.pages[0];
    expect(letteredOf(page.doc)).toMatchObject({ kind: 'letter', verified: true, photoId: 'ai-letter' });
    expect(page.doc.bg.photoId).toBe('ai-letter');
    expect(o.more.get('ai-letter')).toBeTruthy();
    expect(page.doc.layers.find(l => l.id === 'h')?.hidden).toBe(true);
  });
  it('a painting made for another photograph is not put on', () => {
    const d = draft({ postPainted: true }, { painted: { verified: true, missing: [], forId: 'zzz', kind: 'paint' } });
    const o = convertOldDraft(d, new Map([...blobs(), ['painted', blob('P')]]))!;
    expect(letteredOf(o.work.pages[1].doc)).toBeNull();
  });
  it('says when part of it had already gone out', () => {
    expect(convertOldDraft(draft({ sent: { 'wa:announcements:photo-a-1': true } }), blobs())!.partlySent).toBe(true);
    expect(convertOldDraft(draft(), blobs())!.partlySent).toBe(false);
  });
  it('is not opened when the pictures it needs are missing, or when it is a design', () => {
    expect(convertOldDraft(draft({ story: undefined }), blobs())).toBeNull();
    const w = convertOldDraft(draft(), blobs())!.work;
    expect(convertOldDraft({ ...draft(), state: serializeWork(w) as unknown as OldDraftState }, blobs())).toBeNull();
  });
  it('the photograph ids a document names are remapped, and an unknown one is dropped from the crops', () => {
    const d = remapDoc(square('a-1'), new Map([['a-1', PHOTO]]));
    expect(d.bg.photoId).toBe(PHOTO);
    expect(Object.keys(d.placements ?? {})).toEqual([PHOTO]);
  });
});
