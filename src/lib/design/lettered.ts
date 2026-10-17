/**
 * An AI-lettered or AI-painted page, as a change to the page's document (docs/features/design.md, "With AI").
 *
 * Post a piece drew the AI's picture as a render option (`background` + `hideBound`) and could not edit the page
 * while it was on. Design keeps it in the document instead: the picture is one of the design's photographs, the
 * page's background becomes it (filling the frame, no shade over it) and the bound words are hidden — so every
 * way a page is drawn (the strip, Save, the draft, Publish) shows it without knowing, and "Back to our design"
 * puts the background and the hidden words back exactly. Pure.
 */

import { withPlacement, type LetteredMeta, type StoryDoc } from '@/lib/social/editor';

const FILL = { mode: 'fill' as const, zoom: 1, focusX: 0.5, focusY: 0.5 };

export const letteredOf = (d: StoryDoc): LetteredMeta | null => d.meta?.lettered ?? null;

/** Whether a layer is a bound word (the ones the AI's picture already carries). */
const isBound = (l: StoryDoc['layers'][number]) => l.kind === 'text' && !!l.bind;

/** The page with the AI's picture as its background. A page already lettered keeps what it had before the first one. */
export function applyLettered(doc: StoryDoc, photoId: string, info: Omit<LetteredMeta, 'photoId' | 'prev'>): StoryDoc {
  const base = letteredOf(doc) ? removeLettered(doc) : doc;
  const prev: LetteredMeta['prev'] = { bg: base.bg, hidden: base.layers.filter(l => isBound(l) && !l.hidden).map(l => l.id) };
  const bg = { ...base.bg, photoId, dim: 0, gradient: 'none' as const, shade: null, adjust: null, fill: null };
  const layers = base.layers.map(l => (isBound(l) && !l.hidden ? { ...l, hidden: true } : l));
  const next: StoryDoc = withPlacement({ ...base, bg, layers }, FILL);
  return { ...next, meta: { ...base.meta, lettered: { ...info, photoId, prev } } };
}

/** Back to the design's own lettering: the background and the words as they were. */
export function removeLettered(doc: StoryDoc): StoryDoc {
  const m = letteredOf(doc);
  if (!m) return doc;
  const { lettered: _gone, ...meta } = doc.meta ?? {};
  const back = new Set(m.prev.hidden);
  return { ...doc, bg: m.prev.bg, layers: doc.layers.map(l => (back.has(l.id) ? { ...l, hidden: false } : l)), meta: Object.keys(meta).length ? meta : undefined };
}
