/**
 * The optional AI step of a resize (docs/features/design-studio-plan.md §3.2, step 3): the prompt, the schema it
 * answers in, and the cleaner that decides whether the answer may be used at all. Pure and client-safe — the one
 * model call is the route's.
 *
 * The model sees a summary of the layers (ids, roles, boxes, the words as they are) and the deterministic layout, and
 * may only move and resize what is there. It never sees or returns pixels; the jewellery photograph is never drawn.
 * `cleanPlan` throws the whole plan away on a word it changed, an id it invented, a number that is not a number or
 * a place outside the frame. `mergePlan` keeps the deterministic layout unless the plan scores at least as well.
 */

import {
  frameOf, textOf, withPlacement,
  type Assets, type Box, type Box01, type Fields, type Layer, type LayerRole, type StoryDoc,
} from '@/lib/social/editor';
import type { Frame, Placement } from '@/lib/social/story';
import { roleOf } from './roles';
import { safeBands, type SafeBands } from './safe';
import { makeMeasure, reflowDoc, scoreLayout, type Measure } from './score';
import type { ResizeResult } from './resize';

export interface ResizePlan {
  frame: Frame;
  photo?: { mode: 'fill' | 'fit'; zoom: number; focusX: number; focusY: number };
  needsExtend?: boolean;
  layers: { id: string; x?: number; y?: number; width?: number; size?: number; align?: 'left' | 'center' | 'right'; hidden?: boolean; rotate?: number }[];
  note: string;
}

export interface LayerSummary {
  id: string;
  kind: Layer['kind'];
  role: LayerRole;
  box: Box;
  text?: string;
  size?: number;
  align?: 'left' | 'center' | 'right';
}

/** What the model is told about one target (and what the cleaner checks its answer against). */
export interface PlanContext { frame: Frame; layers: LayerSummary[] }

export const MAX_TARGETS = 14;
const MAX_LAYERS = 80;
const WORDS_KEYS = ['text', 'content', 'bind', 'words', 'copy', 'caption', 'headline', 'kicker', 'fields', 'label', 'string'];

const round = (n: number) => Math.round(n);

// ── Summaries and plans ────────────────────────────────────────────────────

export function summariseLayers(doc: StoryDoc, fields: Fields, m: Measure): LayerSummary[] {
  return reflowDoc(doc, fields, m).layers.filter(l => !l.hidden).slice(0, MAX_LAYERS).map(l => {
    const b = m.box(l);
    return {
      id: l.id, kind: l.kind, role: roleOf(l, doc),
      box: { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) },
      ...(l.kind === 'text' ? { text: textOf(l, fields).slice(0, 120), size: l.size, align: l.align } : {}),
    };
  });
}

/** A result as a plan — what the model is shown as the layout to improve. */
export function planOf(r: Pick<ResizeResult, 'frame' | 'doc'>, fields: Fields, m: Measure): ResizePlan {
  const doc = reflowDoc(r.doc, fields, m);
  const pl = doc.placements ? (doc.bg.photoId ? doc.placements[doc.bg.photoId] : undefined) ?? doc.bg.placement : doc.bg.placement;
  return {
    frame: r.frame,
    ...(doc.bg.photoId ? { photo: { mode: pl.mode, zoom: pl.zoom, focusX: pl.focusX, focusY: pl.focusY } } : {}),
    layers: doc.layers.filter(l => !l.hidden).slice(0, MAX_LAYERS).map(l => ({
      id: l.id, x: round(l.x), y: round(l.y),
      ...(l.kind === 'text' ? { width: l.width, size: l.size, align: l.align } : l.kind === 'wordmark' ? { width: l.width } : l.kind === 'image' ? { width: l.w } : { width: Math.abs(l.w) }),
      ...(l.rotate ? { rotate: l.rotate } : {}),
    })),
    note: '',
  };
}

/** The plan laid on the document: positions, sizes, alignment, visibility; the photo's crop. Nothing else changes. */
export function applyPlan(doc: StoryDoc, plan: ResizePlan): StoryDoc {
  const by = new Map(plan.layers.map(p => [p.id, p]));
  const layers = doc.layers.map((l): Layer => {
    const p = by.get(l.id);
    if (!p) return l;
    const base = { ...l, ...(p.x !== undefined ? { x: round(p.x) } : {}), ...(p.y !== undefined ? { y: round(p.y) } : {}), ...(p.rotate !== undefined ? { rotate: p.rotate } : {}), ...(p.hidden !== undefined ? { hidden: p.hidden } : {}) } as Layer;
    switch (base.kind) {
      case 'text': return { ...base, ...(p.width !== undefined ? { width: round(p.width) } : {}), ...(p.size !== undefined ? { size: round(p.size) } : {}), ...(p.align ? { align: p.align } : {}), flow: undefined };
      case 'wordmark': return p.width !== undefined ? { ...base, width: round(p.width) } : base;
      case 'image': return p.width !== undefined ? { ...base, w: round(p.width) } : base;
      default: return p.width !== undefined ? { ...base, w: Math.sign(base.w || 1) * round(p.width) } : base;
    }
  });
  let out: StoryDoc = { ...doc, layers };
  if (plan.photo && out.bg.photoId) out = withPlacement(out, { mode: plan.photo.mode, zoom: plan.photo.zoom, focusX: plan.photo.focusX, focusY: plan.photo.focusY } satisfies Placement);
  return out;
}

// ── The cleaner ────────────────────────────────────────────────────────────

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Why a plan can't be used (null when it can). Whole plans are refused, not trimmed: a model that changed a word can't be trusted with the rest. */
export function planProblem(raw: unknown, ctx: PlanContext): string | null {
  if (!raw || typeof raw !== 'object') return 'not a plan';
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.layers) || r.layers.length > MAX_LAYERS) return 'no layers';
  const known = new Map(ctx.layers.map(l => [l.id, l]));
  const { w, h } = ctx.frame;
  const seen = new Set<string>();
  for (const e of r.layers as unknown[]) {
    if (!e || typeof e !== 'object') return 'a layer is not an object';
    const p = e as Record<string, unknown>;
    if (typeof p.id !== 'string' || !known.has(p.id)) return `unknown layer ${String(p.id).slice(0, 40)}`;
    if (seen.has(p.id)) return `layer ${p.id} twice`;
    seen.add(p.id);
    const src = known.get(p.id)!;
    for (const k of WORDS_KEYS) if (k in p) return `changes the words of ${p.id}`;
    for (const k of ['x', 'y', 'width', 'size', 'rotate'] as const) if (k in p && p[k] !== undefined && !num(p[k])) return `${k} of ${p.id} is not a number`;
    if (num(p.x) && (p.x < -w * 0.05 || p.x > w * 1.05)) return `${p.id} is outside the frame`;
    if (num(p.y) && (p.y < -h * 0.05 || p.y > h * 1.05)) return `${p.id} is outside the frame`;
    if (num(p.size) && (src.kind !== 'text' || p.size < 12 || p.size > 600)) return `bad size for ${p.id}`;
    if (num(p.width) && (p.width < 80 || p.width > 2400)) return `bad width for ${p.id}`;
    if (num(p.rotate) && Math.abs(p.rotate) > 180) return `bad rotation for ${p.id}`;
    if ('align' in p && p.align !== undefined && (src.kind !== 'text' || !['left', 'center', 'right'].includes(p.align as string))) return `bad align for ${p.id}`;
    if ('hidden' in p && p.hidden !== undefined && (typeof p.hidden !== 'boolean' || (p.hidden && src.role !== 'decor' && src.role !== 'mark'))) return `${p.id} may not be hidden`;
  }
  if (r.photo !== undefined && r.photo !== null) {
    const p = r.photo as Record<string, unknown>;
    if (!p || typeof p !== 'object' || (p.mode !== 'fill' && p.mode !== 'fit') || !num(p.zoom) || p.zoom < 1 || p.zoom > 2.5 || !num(p.focusX) || !num(p.focusY) || p.focusX < 0 || p.focusX > 1 || p.focusY < 0 || p.focusY > 1) return 'bad photo crop';
  }
  if (r.frame !== undefined && r.frame !== null) {
    const f = r.frame as Partial<Frame>;
    if (!num(f.w) || !num(f.h) || Math.abs(f.w - w) > 1 || Math.abs(f.h - h) > 1) return 'a different frame';
  }
  return null;
}

/** The plan as the model sent it, if it is safe to use: else null. */
export function cleanPlan(raw: unknown, ctx: PlanContext): ResizePlan | null {
  if (planProblem(raw, ctx)) return null;
  const r = raw as Record<string, unknown>;
  const layers = (r.layers as Record<string, unknown>[]).map(p => ({
    id: p.id as string,
    ...(num(p.x) ? { x: p.x } : {}), ...(num(p.y) ? { y: p.y } : {}),
    ...(num(p.width) ? { width: p.width } : {}), ...(num(p.size) ? { size: p.size } : {}),
    ...(p.align === 'left' || p.align === 'center' || p.align === 'right' ? { align: p.align as 'left' | 'center' | 'right' } : {}),
    ...(typeof p.hidden === 'boolean' ? { hidden: p.hidden } : {}),
    ...(num(p.rotate) ? { rotate: p.rotate } : {}),
  }));
  const photo = r.photo && typeof r.photo === 'object' ? (r.photo as ResizePlan['photo']) : undefined;
  return {
    frame: ctx.frame,
    ...(photo ? { photo: { mode: photo.mode, zoom: photo.zoom, focusX: photo.focusX, focusY: photo.focusY } } : {}),
    ...(r.needsExtend === true ? { needsExtend: true } : {}),
    layers,
    note: typeof r.note === 'string' ? r.note.trim().slice(0, 200) : '',
  };
}

// ── Using a plan ───────────────────────────────────────────────────────────

/**
 * The plan applied to the deterministic result and scored again. It is used only if it scores at least as well; else the
 * deterministic layout stays and the note says so.
 */
export function mergePlan(det: ResizeResult, plan: ResizePlan | null, fields: Fields, assets: Assets, o: { subject?: Box01; photoAspect?: number; measure?: Measure; bands?: SafeBands } = {}): ResizeResult {
  if (!plan) return det;
  const m = o.measure ?? makeMeasure(fields, assets);
  const doc = reflowDoc(applyPlan(det.doc, plan), fields, m);
  const s = scoreLayout(doc, fields, assets, { subject: o.subject, photoAspect: o.photoAspect, measure: m, bands: o.bands ?? safeBands(frameOf(det.doc)) });
  if (s.score >= det.score) {
    return {
      ...det, doc, score: s.score, strategy: 'ai', penalties: s.penalties,
      needsExtend: det.needsExtend || plan.needsExtend === true,
      notes: [plan.note || 'The AI refined the layout.'],
      candidates: [...det.candidates, { strategy: 'ai', score: s.score }],
    };
  }
  return { ...det, notes: [...det.notes, `The AI’s layout scored ${Math.round(s.score)} against ${Math.round(det.score)}, so the plain one stays.`], candidates: [...det.candidates, { strategy: 'ai', score: s.score }] };
}

// ── The prompt and the schema ──────────────────────────────────────────────

export const RESIZE_SYSTEM = [
  'You are a layout editor for a jewellery shop’s social posts and ads.',
  'You are given a design in one shape and, for each shape it must become, a proposed layout. Improve the proposals where you see a real problem; otherwise return the layer positions as proposed.',
  'You may only MOVE and RESIZE layers that exist: x, y (the layer’s anchor, in the target’s own pixels), width, size (text only), align (text only), rotate, and hidden (decorative layers and marks only).',
  'You may NEVER change, add, remove or reword any text; never add layers; never use an id you were not given. You do not draw or alter the photograph; you may only set how it is cropped.',
  'Keep the reading order: kicker, headline, specs, then the call to action last. Keep every word inside the frame; in a frame 1800 px or taller keep words out of the top 14% and bottom 35% (Instagram draws over them). Keep the mark clear of the piece. Text must stay readable: not under 3% of the short side.',
  'Answer with JSON only: {"plans":[{"index":<target number>,"layers":[{"id","x","y","width","size","align"}],"photo":{"mode","zoom","focusX","focusY"},"needsExtend":false,"note":"<one short sentence>"}]}.',
].join('\n');

/** Vertex response schema (uppercase OpenAPI types). */
export const RESIZE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    plans: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER' },
          note: { type: 'STRING' },
          needsExtend: { type: 'BOOLEAN' },
          photo: {
            type: 'OBJECT',
            properties: { mode: { type: 'STRING', enum: ['fill', 'fit'] }, zoom: { type: 'NUMBER' }, focusX: { type: 'NUMBER' }, focusY: { type: 'NUMBER' } },
            required: ['mode', 'zoom', 'focusX', 'focusY'],
          },
          layers: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id: { type: 'STRING' }, x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, width: { type: 'NUMBER' }, size: { type: 'NUMBER' },
                align: { type: 'STRING', enum: ['left', 'center', 'right'] }, hidden: { type: 'BOOLEAN' }, rotate: { type: 'NUMBER' },
              },
              required: ['id'],
            },
          },
        },
        required: ['index', 'layers', 'note'],
      },
    },
  },
  required: ['plans'],
};

export interface ResizeAiRequest {
  goal?: string;
  source: { frame: Frame; layers: LayerSummary[]; thumb?: string };
  targets: { frame: Frame; score: number; problems?: string[]; layers: LayerSummary[]; plan?: ResizePlan; thumb?: string }[];
}

/** The text of the one question: the source, then every target with its proposal and what is wrong with it. */
export function resizePrompt(req: ResizeAiRequest): string {
  const lay = (ls: LayerSummary[]) => ls.map(l => `  ${l.id} ${l.role}/${l.kind} box=${l.box.x},${l.box.y},${l.box.w}x${l.box.h}${l.text ? ` size=${l.size} ${l.align} "${l.text}"` : ''}`).join('\n');
  const parts = [
    req.goal ? `What the person wants: ${req.goal.slice(0, 300)}` : '',
    `SOURCE ${req.source.frame.w}x${req.source.frame.h}:\n${lay(req.source.layers)}`,
    ...req.targets.map((t, i) => [
      `TARGET ${i}: ${t.frame.w}x${t.frame.h} (score ${Math.round(t.score)}/100${t.problems?.length ? `; problems: ${t.problems.join('; ')}` : ''})`,
      lay(t.layers),
      t.plan ? `  photo crop: ${JSON.stringify(t.plan.photo ?? null)}` : '',
    ].filter(Boolean).join('\n')),
  ];
  return parts.filter(Boolean).join('\n\n');
}

const frameOk = (f: unknown): f is Frame => !!f && typeof f === 'object' && num((f as Frame).w) && num((f as Frame).h) && (f as Frame).w >= 100 && (f as Frame).w <= 10_000 && (f as Frame).h >= 100 && (f as Frame).h <= 10_000;
const layerOk = (l: unknown): l is LayerSummary => !!l && typeof l === 'object' && typeof (l as LayerSummary).id === 'string' && (l as LayerSummary).id.length <= 80 && !!(l as LayerSummary).box && num((l as LayerSummary).box.x) && num((l as LayerSummary).box.y) && num((l as LayerSummary).box.w) && num((l as LayerSummary).box.h);

/** What a request must look like to be worth a model call; null when it isn't. Free text is clipped, not trusted. */
export function cleanRequest(raw: unknown): ResizeAiRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const src = r.source as Record<string, unknown> | undefined;
  if (!src || !frameOk(src.frame) || !Array.isArray(src.layers) || !src.layers.every(layerOk)) return null;
  if (!Array.isArray(r.targets) || !r.targets.length || r.targets.length > MAX_TARGETS) return null;
  const jpeg = (v: unknown) => (typeof v === 'string' && /^[\w+/=]{1,200000}$/.test(v) ? v : undefined);
  const clip = (l: LayerSummary): LayerSummary => ({ ...l, ...(l.text ? { text: String(l.text).slice(0, 120) } : {}) });
  const targets: ResizeAiRequest['targets'] = [];
  for (const t of r.targets as Record<string, unknown>[]) {
    if (!t || !frameOk(t.frame) || !Array.isArray(t.layers) || t.layers.length > MAX_LAYERS || !t.layers.every(layerOk)) return null;
    targets.push({
      frame: t.frame, score: num(t.score) ? t.score : 0,
      ...(Array.isArray(t.problems) ? { problems: t.problems.filter((p): p is string => typeof p === 'string').slice(0, 6).map(p => p.slice(0, 120)) } : {}),
      layers: (t.layers as LayerSummary[]).map(clip),
      ...(jpeg(t.thumb) ? { thumb: jpeg(t.thumb) } : {}),
    });
  }
  if ((src.layers as unknown[]).length > MAX_LAYERS) return null;
  return {
    ...(typeof r.goal === 'string' && r.goal.trim() ? { goal: r.goal.trim().slice(0, 300) } : {}),
    source: { frame: src.frame, layers: (src.layers as LayerSummary[]).map(clip), ...(jpeg(src.thumb) ? { thumb: jpeg(src.thumb) } : {}) },
    targets,
  };
}

/** What the route answers. `plans` has one entry per target, null where the model's was unusable or absent. */
export interface ResizeAiResponse { ai: boolean; plans: (ResizePlan | null)[]; reason?: string }

/** The model's answer, target by target, through the cleaner. */
export function plansFromAnswer(answer: unknown, req: ResizeAiRequest): (ResizePlan | null)[] {
  const list = answer && typeof answer === 'object' && Array.isArray((answer as { plans?: unknown }).plans) ? ((answer as { plans: Record<string, unknown>[] }).plans) : [];
  return req.targets.map((t, i) => {
    const raw = list.find(p => p && p.index === i);
    return raw ? cleanPlan(raw, { frame: t.frame, layers: t.layers }) : null;
  });
}
