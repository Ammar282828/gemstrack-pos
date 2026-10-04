/**
 * The Studio's boards (the owner, 2026-10-04, after an audit of pen.dev: "sure run it"): an endless
 * canvas of designs side by side, each one the maker's own layout document (a StoryDoc) on one
 * photograph from the library, with sticky notes beside them. The page and a connected agent
 * (Claude Code over /api/studio/mcp) change a board the same way — by operations applied on the
 * server in a transaction — so neither can overwrite the other's work.
 *
 * Pure: shared by the server (board.ts, the MCP route) and the page. Tested.
 */

import type { Fields, Layer, StoryDoc } from '@/lib/social/editor';
import { AD_FORMATS, isAdFormat, type AdFormat, type AdTemplateId } from './templates';

export const TEMPLATE_IDS = ['clean', 'headline', 'framed', 'heritage', 'band', 'certified', 'rate', 'investment'] as const satisfies readonly AdTemplateId[];
export const isTemplateId = (v: unknown): v is AdTemplateId => typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v);

/** Board units per design pixel: a 1080-px-wide design is 360 units across on the board. */
export const BOARD_SCALE = 1 / 3;
export const GAP = 48;

export interface BoardFrame {
  id: string;
  /** Top-left corner on the board, in board units. */
  x: number; y: number;
  label: string;
  format: AdFormat;
  /** The library photo (`site:…` / `drive:…`), or null for a design without one. */
  assetId: string | null;
  /** The photo carries the house's mark already (taheri.shop burns it in): layouts add none. */
  marked: boolean;
  template: AdTemplateId;
  /** The layout's words: kicker, headline, weight (the specs line), details (the call to action). */
  fields: Fields;
  /** Null until the page lays the template out (an agent's or a new frame's: the layout needs the photo and the fonts). */
  doc: StoryDoc | null;
  /** Who last changed it, and how many times it has changed (the page re-draws its picture for the agent when this moves). */
  by: 'page' | 'agent' | 'ai';
  rev: number;
  /** The AI's reason for the design, when the AI made it. */
  why?: string;
}

export interface BoardNote { id: string; x: number; y: number; text: string; by: 'page' | 'agent' }

export interface Board {
  id: string;
  name: string;
  frames: BoardFrame[];
  notes: BoardNote[];
  rev: number;
  updated: string;
  by: string;
}

export type BoardOp =
  /** `near`: the design it came from — the new one goes in the first free place to its right. */
  | { op: 'add'; frame: Partial<BoardFrame> & { assetId: string | null }; near?: string }
  | { op: 'put'; id: string; patch: Partial<Omit<BoardFrame, 'id' | 'rev'>> }
  | { op: 'move'; id: string; x: number; y: number }
  | { op: 'remove'; id: string }
  | { op: 'note'; note: Partial<BoardNote> & { text: string } }
  | { op: 'noteMove'; id: string; x: number; y: number }
  | { op: 'noteText'; id: string; text: string }
  | { op: 'noteRemove'; id: string }
  | { op: 'rename'; name: string };

export const MAX_FRAMES = 120;
export const MAX_NOTES = 80;
const MAX_LAYERS = 80;
const MAX_DOC_BYTES = 60_000;

/**
 * A layout that works for the photo and the shape. The full-bleed layouts (the photo filling the frame,
 * the words over it) put the words across the piece on a 9:16, and cut the wordmark taheri.shop burns
 * into its photos; those get the framed layout (the photo inset whole, the words beneath) instead.
 * Seen on the first weekly board, 2026-10-04.
 */
const FULL_BLEED: readonly AdTemplateId[] = ['headline', 'clean', 'band', 'certified'];
export function safeTemplate(t: AdTemplateId, o: { marked: boolean; format: AdFormat }): AdTemplateId {
  return (o.marked || o.format === 'story') && FULL_BLEED.includes(t) ? 'framed' : t;
}

export const newId = (k: string) => `${k}-${Math.random().toString(36).slice(2, 9)}`;
const num = (v: unknown, d: number, lo = -1e6, hi = 1e6) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);

export const BLANK_FIELDS: Fields = { kicker: '', headline: '', weight: '', details: '' };
export function cleanFields(v: unknown, base: Fields = BLANK_FIELDS): Fields {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    kicker: str(o.kicker, 60, base.kicker),
    headline: str(o.headline, 140, base.headline),
    weight: str(o.weight, 160, base.weight),
    details: str(o.details, 80, base.details),
  };
}

const LAYER_KINDS = new Set(['text', 'wordmark', 'arrow', 'line', 'rect', 'circle', 'shape', 'image']);

/**
 * A layout document as it may be kept: a background and at most 80 layers, every layer of a kind the
 * renderer draws, numbers finite, no uploaded pictures (a board's frames draw only their library photo),
 * and no bigger than 60 KB. Throws (status 400) with what was wrong; returns the cleaned document.
 */
export function cleanDoc(v: unknown): StoryDoc {
  const bad = (m: string) => Object.assign(new Error(`The design isn’t valid: ${m}.`), { status: 400 });
  if (!v || typeof v !== 'object') throw bad('it is not an object');
  const d = v as Partial<StoryDoc>;
  if (!d.bg || typeof d.bg !== 'object') throw bad('it has no `bg`');
  if (!Array.isArray(d.layers)) throw bad('`layers` is not a list');
  if (d.layers.length > MAX_LAYERS) throw bad(`more than ${MAX_LAYERS} layers`);
  const layers: Layer[] = d.layers.map((l, i) => {
    if (!l || typeof l !== 'object' || !LAYER_KINDS.has((l as Layer).kind)) throw bad(`layer ${i} is of no kind the renderer draws (${LAYER_KINDS.size} kinds: ${[...LAYER_KINDS].join(', ')})`);
    const layer = { ...(l as Layer) } as Layer & { src?: string };
    if (!layer.id || typeof layer.id !== 'string') layer.id = newId(layer.kind);
    if (layer.kind === 'image') delete layer.src;
    for (const k of ['x', 'y', 'w', 'h', 'width', 'size', 'rotate', 'opacity'] as const) {
      const val = (layer as unknown as Record<string, unknown>)[k];
      if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val))) throw bad(`layer ${i} (${layer.kind}) has a ${k} that is not a number`);
    }
    if (layer.kind === 'text' && typeof (layer as { text?: unknown }).text !== 'string') throw bad(`text layer ${i} has no text`);
    return layer;
  });
  const frame = d.frame && typeof d.frame === 'object'
    ? { w: Math.round(num(d.frame.w, 1080, 200, 4000)), h: Math.round(num(d.frame.h, 1350, 200, 4000)) }
    : undefined;
  const out: StoryDoc = { ...(d as StoryDoc), layers, ...(frame ? { frame } : {}) };
  if (JSON.stringify(out).length > MAX_DOC_BYTES) throw bad('it is bigger than 60 KB');
  return out;
}

/** The design's size in pixels: its document's frame, else its format's. */
export function framePx(f: Pick<BoardFrame, 'format' | 'doc'>): { w: number; h: number } {
  if (f.doc?.frame) return f.doc.frame;
  const info = f.format !== 'custom' ? AD_FORMATS[f.format] : AD_FORMATS.portrait;
  return info.frame;
}

/** A spot for a new design: to the right of everything on the row the board's top starts on, else below. */
export function nextSpot(frames: BoardFrame[], size: { w: number; h: number }, near?: BoardFrame): { x: number; y: number } {
  const w = size.w * BOARD_SCALE;
  if (near) {
    // Beside the design it came from: the first free place to its right on the same row.
    let x = near.x + framePx(near).w * BOARD_SCALE + GAP;
    const row = frames.filter(f => f.y < near.y + framePx(near).h * BOARD_SCALE && f.y + framePx(f).h * BOARD_SCALE > near.y);
    for (let guard = 0; guard < MAX_FRAMES; guard++) {
      const hit = row.find(f => x < f.x + framePx(f).w * BOARD_SCALE + GAP && x + w + GAP > f.x);
      if (!hit) break;
      x = hit.x + framePx(hit).w * BOARD_SCALE + GAP;
    }
    return { x, y: near.y };
  }
  if (!frames.length) return { x: 0, y: 0 };
  const right = Math.max(...frames.map(f => f.x + framePx(f).w * BOARD_SCALE));
  const top = Math.min(...frames.map(f => f.y));
  return { x: right + GAP, y: top };
}

function cleanFrameInput(v: Partial<BoardFrame>, base?: BoardFrame): Omit<BoardFrame, 'id' | 'rev' | 'x' | 'y'> & { x?: number; y?: number } {
  const format: AdFormat = isAdFormat(v.format) ? v.format : base?.format ?? 'portrait';
  const template: AdTemplateId = isTemplateId(v.template) ? v.template : base?.template ?? 'headline';
  const doc = v.doc === undefined ? base?.doc ?? null : v.doc === null ? null : cleanDoc(v.doc);
  return {
    label: str(v.label, 80, base?.label ?? ''),
    format,
    assetId: v.assetId === undefined ? base?.assetId ?? null : v.assetId === null ? null : str(v.assetId, 300),
    marked: typeof v.marked === 'boolean' ? v.marked : base?.marked ?? false,
    template,
    fields: v.fields === undefined ? base?.fields ?? BLANK_FIELDS : cleanFields(v.fields, base?.fields),
    doc,
    by: v.by === 'agent' || v.by === 'ai' || v.by === 'page' ? v.by : base?.by ?? 'page',
    ...(v.why !== undefined || base?.why ? { why: str(v.why ?? base?.why, 400) } : {}),
    ...(v.x !== undefined ? { x: num(v.x, 0) } : {}),
    ...(v.y !== undefined ? { y: num(v.y, 0) } : {}),
  };
}

/**
 * Apply operations to a board (a copy is returned; the board's rev is not touched — the store does that).
 * Throws (status 400/404) on an operation that can't be applied, naming it.
 */
export function applyOps(board: Board, ops: BoardOp[]): { board: Board; added: string[] } {
  let frames = board.frames.slice();
  let notes = board.notes.slice();
  let name = board.name;
  const added: string[] = [];
  const notFound = (what: string, id: string) => Object.assign(new Error(`There is no ${what} “${id}” on this board.`), { status: 404 });
  for (const o of ops) {
    switch (o.op) {
      case 'add': {
        if (frames.length >= MAX_FRAMES) throw Object.assign(new Error(`A board holds ${MAX_FRAMES} designs.`), { status: 400 });
        const c = cleanFrameInput(o.frame);
        const spot = c.x !== undefined && c.y !== undefined ? { x: c.x, y: c.y } : nextSpot(frames, framePx(c), o.near ? frames.find(f => f.id === o.near) : undefined);
        const id = typeof o.frame.id === 'string' && /^[\w-]{3,40}$/.test(o.frame.id) && !frames.some(f => f.id === o.frame.id) ? o.frame.id : newId('frame');
        frames.push({ ...c, id, x: spot.x, y: spot.y, rev: 1 });
        added.push(id);
        break;
      }
      case 'put': {
        const i = frames.findIndex(f => f.id === o.id);
        if (i < 0) throw notFound('design', o.id);
        const c = cleanFrameInput(o.patch as Partial<BoardFrame>, frames[i]);
        frames[i] = { ...frames[i], ...c, x: c.x ?? frames[i].x, y: c.y ?? frames[i].y, rev: frames[i].rev + 1 };
        break;
      }
      case 'move': {
        const i = frames.findIndex(f => f.id === o.id);
        if (i < 0) throw notFound('design', o.id);
        frames[i] = { ...frames[i], x: num(o.x, frames[i].x), y: num(o.y, frames[i].y) };
        break;
      }
      case 'remove':
        frames = frames.filter(f => f.id !== o.id);
        break;
      case 'note': {
        if (notes.length >= MAX_NOTES) throw Object.assign(new Error(`A board holds ${MAX_NOTES} notes.`), { status: 400 });
        const text = str(o.note.text, 1000).trim();
        if (!text) throw Object.assign(new Error('A note needs words.'), { status: 400 });
        const id = typeof o.note.id === 'string' && /^[\w-]{3,40}$/.test(o.note.id) && !notes.some(n => n.id === o.note.id) ? o.note.id : newId('note');
        const spot = typeof o.note.x === 'number' && typeof o.note.y === 'number' ? { x: o.note.x, y: o.note.y } : { x: -280, y: notes.length * 200 };
        notes.push({ id, x: num(spot.x, 0), y: num(spot.y, 0), text, by: o.note.by === 'agent' ? 'agent' : 'page' });
        added.push(id);
        break;
      }
      case 'noteMove': {
        const i = notes.findIndex(n => n.id === o.id);
        if (i < 0) throw notFound('note', o.id);
        notes[i] = { ...notes[i], x: num(o.x, notes[i].x), y: num(o.y, notes[i].y) };
        break;
      }
      case 'noteText': {
        const i = notes.findIndex(n => n.id === o.id);
        if (i < 0) throw notFound('note', o.id);
        notes[i] = { ...notes[i], text: str(o.text, 1000) };
        break;
      }
      case 'noteRemove':
        notes = notes.filter(n => n.id !== o.id);
        break;
      case 'rename': {
        const n = str(o.name, 60).trim();
        if (!n) throw Object.assign(new Error('Name the board.'), { status: 400 });
        name = n;
        break;
      }
      default:
        throw Object.assign(new Error(`Unknown operation ${(o as { op?: unknown }).op}.`), { status: 400 });
    }
  }
  return { board: { ...board, name, frames, notes }, added };
}

/** Every line of words a design shows: its fields and its text layers. */
export function wordsOf(f: Pick<BoardFrame, 'fields' | 'doc'>): string[] {
  const out = [f.fields.kicker, f.fields.headline, f.fields.details].filter(Boolean);
  for (const l of f.doc?.layers ?? []) if (l.kind === 'text' && !l.bind && l.text.trim()) out.push(l.text);
  return out;
}
