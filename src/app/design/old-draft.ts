/**
 * A draft of the old Post a piece screen, opened as a design (docs/features/design.md, "Old drafts").
 *
 * That screen kept its piece as words (headline, weight, metal, stones…), two documents (the story and the square),
 * a list of photographs and — when the AI had lettered or painted — those pictures beside them. A design is a set of
 * pages over one photograph and a few more, so the story becomes the master page, the square the WhatsApp page, the
 * lead photograph is *the* photograph, the others keep their ids as the design's further photographs, and an AI
 * lettering or painting that was switched on is applied to its page (lib/design/lettered.ts). Where it was going
 * (collection, groups, Instagram) is not part of a design: the collection is handed to the Publish sheet through
 * the device's remembered one; what the old screen had already sent is not carried (it says so, once).
 *
 * Pure: it reads a draft and its photographs and returns what to open, or null when the draft is not one the old
 * screen wrote or has no story or square to open.
 */

import { PHOTO } from '@/lib/ads/studio/templates';
import { detailsLine, weightLabel } from '@/lib/social/caption';
import type { PostDraft } from '@/lib/social/post-drafts';
import type { Fields, StoryDoc } from '@/lib/social/editor';
import { ID_OK } from '@/lib/design/model';
import { applyLettered } from '@/lib/design/lettered';
import { isDesignDraft, newWork, type DesignWork } from './design-state';

/** The parts of the old screen's saved state this reads (all optional: a draft from any of its versions opens). */
export interface OldDraftState {
  kicker?: string; headline?: string; weight?: string; weightEach?: boolean; metal?: string; stones?: string; hook?: string;
  story?: StoryDoc; square?: StoryDoc;
  lettering?: 'ours' | 'ai'; postPainted?: boolean;
  folder?: string; caption?: string; aiCaption?: { instagramCaption?: string } | null;
  formats?: 'both' | 'story' | 'square';
  uploaded?: Record<string, string>; sent?: Record<string, boolean>;
}

export const isOldPostDraft = (state: unknown): state is OldDraftState =>
  !!state && typeof state === 'object' && !isDesignDraft(state) && ('story' in state || 'square' in state || 'headline' in state);

export interface OpenedOldDraft {
  work: DesignWork;
  /** The lead photograph (the design's `photo`). */
  main: { blob: Blob; label: string } | null;
  /** The others, by the ids the pages' documents now use. */
  more: Map<string, Blob>;
  /** The lead photograph already carries the house's marks (it came from the website). */
  marked: boolean;
  /** The collection the old screen had chosen, for the Publish sheet's remembered one. */
  folder: string;
  /** Something had already gone out from the old screen (the Publish sheet cannot know). */
  partlySent: boolean;
}

const remapId = (id: string | null | undefined, ids: Map<string, string>): string | null => (id ? ids.get(id) ?? null : null);

/** The document drawn from the design's photographs: every photograph id it names, through `ids`. */
export function remapDoc(doc: StoryDoc, ids: Map<string, string>): StoryDoc {
  const placements = doc.placements
    ? Object.fromEntries(Object.entries(doc.placements).flatMap(([k, v]) => { const to = ids.get(k); return to ? [[to, v]] : []; }))
    : undefined;
  return {
    ...doc,
    bg: { ...doc.bg, photoId: remapId(doc.bg.photoId, ids) },
    layers: doc.layers.map(l => (l.kind === 'image' && !l.src ? { ...l, photoId: ids.get(l.photoId) ?? l.photoId } : l)),
    ...(placements ? { placements } : {}),
  };
}

export function convertOldDraft(draft: PostDraft<OldDraftState>, blobs: Map<string, Blob>): OpenedOldDraft | null {
  const s = draft.state;
  if (!isOldPostDraft(s)) return null;
  const formats = s.formats === 'story' || s.formats === 'square' ? s.formats : 'both';
  const wantStory = formats !== 'square', wantSquare = formats !== 'story';
  if ((wantStory && !s.story) || (wantSquare && !s.square) || (!s.story && !s.square)) return null;

  // The photographs that still exist, the lead one first.
  const have = draft.photos.filter(p => blobs.has(p.id));
  const leadId = (wantStory ? s.story?.bg.photoId : s.square?.bg.photoId) ?? have[0]?.id ?? null;
  const lead = have.find(p => p.id === leadId) ?? have[0] ?? null;
  const ids = new Map<string, string>();
  if (lead) ids.set(lead.id, PHOTO);
  let n = 0;
  for (const p of have) if (!ids.has(p.id)) ids.set(p.id, `old-${++n}`);
  const more = new Map<string, Blob>();
  for (const p of have) if (p.id !== lead?.id) more.set(ids.get(p.id)!, blobs.get(p.id)!);

  const piece = { headline: s.headline ?? '', kicker: s.kicker ?? '', weight: s.weight ?? '', weightEach: !!s.weightEach, metal: s.metal ?? '', stones: s.stones ?? '', hook: s.hook ?? '' };
  const weightShown = !!s.story?.layers.some(l => l.kind === 'text' && l.bind === 'weight' && !l.hidden);
  const fields: Partial<Fields> = { kicker: piece.kicker, headline: piece.headline, weight: weightLabel(piece), details: detailsLine(piece, !weightShown) };

  // AI lettering / painting that was on, for the page it was made for.
  let story = s.story ? remapDoc(s.story, ids) : null;
  let square = s.square ? remapDoc(s.square, ids) : null;
  const letterBlob = blobs.get('lettered'), paintBlob = blobs.get('painted');
  if (story && s.lettering === 'ai' && draft.lettered && letterBlob && (!draft.lettered.forId || draft.lettered.forId === s.story?.bg.photoId)) {
    story = applyLettered(story, 'ai-letter', { kind: draft.lettered.kind ?? 'letter', verified: draft.lettered.verified, missing: draft.lettered.missing ?? [], check: draft.lettered.check ?? null });
    more.set('ai-letter', letterBlob);
  }
  if (square && s.postPainted && draft.painted && paintBlob && (!draft.painted.forId || draft.painted.forId === s.square?.bg.photoId)) {
    square = applyLettered(square, 'ai-paint', { kind: 'paint', verified: draft.painted.verified, missing: draft.painted.missing ?? [], check: draft.painted.check ?? null });
    more.set('ai-paint', paintBlob);
  }

  const kind = formats === 'both' ? 'piece' : formats === 'story' ? 'story' : 'whatsapp';
  const w = newWork({ kind, sizes: [...(wantStory ? [{ id: 'story' }] : []), ...(wantSquare ? [{ id: 'whatsapp' }] : [])], name: piece.headline, fields,
    ...(have.find(p => p.from)?.from?.id ? { source: { siteId: have.find(p => p.from)!.from!.id } } : {}) });
  const docs = [...(wantStory ? [story!] : []), ...(wantSquare ? [square!] : [])];
  const caption = (s.caption ?? '').trim();
  const ig = (s.aiCaption?.instagramCaption ?? '').trim();
  const work: DesignWork = {
    ...w, fresh: false, dirty: true,
    pages: w.pages.map((p, i) => ({ ...p, doc: docs[i], frame: docs[i].frame ?? p.frame, ver: 0 })),
    copy: { ...(caption ? { wa: caption.slice(0, 2000) } : {}), ...(ig ? { ig: ig.slice(0, 2200) } : {}) },
  };
  if (work.pages.some(p => !ID_OK.test(p.id))) return null;

  return {
    work,
    main: lead ? { blob: blobs.get(lead.id)!, label: lead.name || draft.title || 'Photo' } : null,
    more,
    marked: !!lead?.from?.marked && !lead.ai,
    folder: typeof s.folder === 'string' ? s.folder : '',
    partlySent: Object.keys(s.uploaded ?? {}).length > 0 || Object.values(s.sent ?? {}).some(Boolean),
  };
}
