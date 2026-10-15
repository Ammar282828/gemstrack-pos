/**
 * The sizes of one ad, edited as one (2026-10-15, owner: "for all designs that have a different size variant, let
 * me link and unlink the texts so i can mass edit the ratios").
 *
 * - A design's sizes share a `group` (BoardFrame.group): "Make a size" puts the copy in its original's group.
 * - A text is linked across them by a key: its `link`, or for a text bound to a field (`bind`) the field itself.
 *   Text layers in other sizes with the same key are the same words. Unlinking sets `unlinked` and keeps the key,
 *   so linking again finds the same twins.
 * - When a design is saved, what changed on a linked text is carried to its twins in the other sizes, and
 *   nothing else: the words (and their mixed styles), the font, colour, case, spacing, effects. Size goes as a
 *   ratio (made 20% bigger here, 20% bigger there), so each size keeps its own scale. Where the text sits, how
 *   wide it runs and how it aligns stay each size's own: that is the point of having sizes. A change of field
 *   goes to the other sizes too, unless the text showing it was unlinked there or here.
 * - Linking a text (giving it a key it did not have) finds its twin in each other size — the same words, else
 *   the text bound to the same field — and makes it match; a size without one gets a copy, placed in proportion.
 *   Unlinking leaves every size as it is, and that text free (both ways) from then on.
 *
 * Pure; board-shape.ts's applyOps calls it on every `put`, so the page, the agent and the weekly board all
 * follow it. Tested.
 */

import { scaleBox, type Fields, type Layer, type StoryDoc, type TextLayer } from '@/lib/social/editor';
import type { BoardFrame } from './board-shape';
import { AD_FORMATS } from './templates';

type Text = TextLayer;
const MAX_LAYERS = 80;
const MAX_DOC_BYTES = 60_000;

/** The key a text is linked by, or null when it stands alone. */
export function linkKey(l: Layer): string | null {
  if (l.kind !== 'text') return null;
  const t = l as Text;
  if (t.unlinked) return null;
  return t.link || (t.bind ? `bind:${t.bind}` : null);
}

/** The other sizes of a design (same group), in board order. */
export function sizesOf(frames: BoardFrame[], f: Pick<BoardFrame, 'id' | 'group'>): BoardFrame[] {
  return f.group ? frames.filter(x => x.id !== f.id && x.group === f.group) : [];
}

/** What is carried from a text to its twins as it is (size goes as a ratio; place, width, align and turn stay). */
const SHARED = ['text', 'runs', 'font', 'color', 'upper', 'spacing', 'lineHeight', 'shadow', 'effect', 'box', 'underline', 'fillGradient', 'list', 'curve', 'autoColor', 'opacity', 'fit', 'layerFx', 'blend'] as const;
type SharedKey = typeof SHARED[number];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// The same words, whatever the case, line breaks or a full stop.
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const frameOf = (f: Pick<BoardFrame, 'doc' | 'format'>) => f.doc?.frame ?? (f.format !== 'custom' ? AD_FORMATS[f.format] : AD_FORMATS.portrait).frame;
const round = (v: number) => Math.round(v * 100) / 100;

function setShared(to: Text, from: Text, keys: readonly SharedKey[]): Text {
  const out = { ...to } as Record<string, unknown>;
  for (const k of keys) {
    const v = (from as unknown as Record<string, unknown>)[k];
    if (v === undefined) delete out[k]; else out[k] = structuredClone(v);
  }
  return out as unknown as Text;
}

/** A text's twin in another size: the same key; else, for a newly linked text, the same words or the same field. */
function twinIn(doc: StoryDoc, key: string, src: Text, claim: boolean): number {
  const at = doc.layers.findIndex(l => linkKey(l) === key);
  if (at >= 0 || !claim) return at;
  // A text unlinked on purpose is never claimed.
  const free = (l: Layer): l is Text => l.kind === 'text' && !linkKey(l) && !(l as Text).unlinked;
  const byWords = doc.layers.findIndex(l => free(l) && !!words(l.text) && words(l.text) === words(src.text));
  if (byWords >= 0) return byWords;
  if (src.bind) return doc.layers.findIndex(l => free(l) && l.bind === src.bind);
  return -1;
}

/** A copy of a text for a size that has none, placed where it sits in its own size, in proportion. */
function placedCopy(src: Text, from: { w: number; h: number }, to: { w: number; h: number }, ids: Set<string>): Text {
  const sx = to.w / from.w, sy = to.h / from.h;
  let id = `${src.id}-l`;
  for (let n = 2; ids.has(id); n++) id = `${src.id}-l${n}`;
  const copy: Text = { ...structuredClone(src), id, x: round(src.x * sx), y: round(src.y * sy), width: round(src.width * sx), size: round(src.size * Math.min(sx, sy)) };
  delete copy.flow;   // its stack is in the other size
  return copy;
}

export interface LinkedChange { id: string; doc?: StoryDoc; fields?: Fields }

/**
 * What saving `after` (was `before`) does to the design's other sizes: one change per size that moves. Sizes
 * without a layout yet only take field changes (their layout is made from the fields when it is laid out).
 */
export function linkedChanges(before: BoardFrame, after: BoardFrame, others: BoardFrame[]): LinkedChange[] {
  if (!others.length) return [];
  const was = new Map((before.doc?.layers ?? []).map(l => [l.id, l]));
  const now = (after.doc?.layers ?? []).filter((l): l is Text => linkKey(l) !== null);

  // Each linked text: what changed on it, or (newly linked) all of it.
  const edits = now.map(l => {
    const old = was.get(l.id) as Text | undefined;
    const fresh = !old || linkKey(old) !== linkKey(l);
    const keys = fresh ? SHARED : SHARED.filter(k => !same((old as unknown as Record<string, unknown>)[k], (l as unknown as Record<string, unknown>)[k]));
    const ratio = !fresh && old!.size > 0 && Math.abs(l.size - old!.size) > 0.01 ? l.size / old!.size : 1;
    return { l, key: linkKey(l)!, fresh, keys, ratio };
  }).filter(e => e.fresh || e.keys.length || e.ratio !== 1);

  // Fields that changed, unless the text showing that field was unlinked here.
  const unlinkedBinds = (d: StoryDoc | null) => new Set((d?.layers ?? []).filter(l => l.kind === 'text' && l.bind && (l as Text).unlinked).map(l => (l as Text).bind!));
  const freeHere = unlinkedBinds(after.doc);
  const fieldKeys = (Object.keys(after.fields) as (keyof Fields)[]).filter(k => after.fields[k] !== before.fields[k] && !freeHere.has(k));

  const out: LinkedChange[] = [];
  for (const o of others) {
    let fields: Fields | undefined;
    const freeThere = unlinkedBinds(o.doc);
    for (const k of fieldKeys) if (!freeThere.has(k) && o.fields[k] !== after.fields[k]) (fields ??= { ...o.fields })[k] = after.fields[k];

    let doc: StoryDoc | undefined;
    if (o.doc && edits.length) {
      const layers = o.doc.layers.slice();
      let moved = false;
      for (const e of edits) {
        const i = twinIn({ ...o.doc, layers }, e.key, e.l, e.fresh);
        if (i < 0) {
          if (!e.fresh || layers.length >= MAX_LAYERS) continue;
          layers.push(placedCopy(e.l, frameOf(after), frameOf(o), new Set(layers.map(l => l.id))));
          moved = true;
          continue;
        }
        const t = layers[i] as Text;
        let next = setShared(t, e.l, e.keys);
        // A background (a button's pill) at the twin's own scale, as its words are.
        if (e.keys.includes('box') && e.l.box && e.l.size > 0) next.box = scaleBox(e.l.box, (e.ratio !== 1 ? t.size * e.ratio : t.size) / e.l.size);
        if (e.ratio !== 1) next.size = round(t.size * e.ratio);
        // A twin found by its words or field takes the key, so it stays linked.
        if (e.key !== linkKey(t)) { next = { ...next, link: e.key }; delete next.unlinked; }
        if (!same(next, t)) { layers[i] = next; moved = true; }
      }
      if (moved) {
        const d = { ...o.doc, layers };
        if (JSON.stringify(d).length <= MAX_DOC_BYTES) doc = d;
      }
    }
    if (doc || fields) out.push({ id: o.id, ...(doc ? { doc } : {}), ...(fields ? { fields } : {}) });
  }
  return out;
}

/** How many other sizes a text is linked into (for the editor's "Linked · 2 sizes"). */
export function linkedCount(others: Pick<BoardFrame, 'doc'>[], l: Layer): number {
  const key = linkKey(l);
  if (!key) return 0;
  return others.filter(o => !o.doc || o.doc.layers.some(x => linkKey(x) === key)).length;
}

/** Every text of a design linked (those unlinked on purpose aside), for a new size made from it. */
export function linkAll(doc: StoryDoc): StoryDoc {
  let moved = false;
  const layers = doc.layers.map(l => {
    if (l.kind !== 'text' || linkKey(l) || l.unlinked) return l;
    moved = true;
    return { ...l, link: `t-${Math.random().toString(36).slice(2, 9)}` };
  });
  return moved ? { ...doc, layers } : doc;
}

/** Link a text (again) or unlink it: the layer as it should be saved. */
export function toggleLink<L extends Layer>(l: L): L {
  if (l.kind !== 'text') return l;
  const t = { ...(l as unknown as Text) };
  if (linkKey(t)) t.unlinked = true;
  else { delete t.unlinked; if (!t.link && !t.bind) t.link = `t-${Math.random().toString(36).slice(2, 9)}`; }
  return t as unknown as L;
}
