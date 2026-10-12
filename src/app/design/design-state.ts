/**
 * Design's working state (docs/features/design-studio-plan.md §5.2, WP6): the design being made as a set of pages
 * — a master and its resized copies — each with its own layout document. Pure and tested; the React hook
 * (use-design.ts) only holds it, and the editor reports its edits through `editDoc`.
 *
 * The rules this keeps:
 *   - editing the master marks every page that was resized from it as stale (offered "Re-do from master");
 *   - editing a resized page makes it the person's own (origin 'manual'): a re-sync never overwrites it;
 *   - a document set from outside the editor (a layout laid down, a resize, a re-do) bumps `ver`, which is what
 *     makes the editor start over from it; the editor's own edits never do.
 */

import type { Fields, StoryDoc } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';
import { AD_FORMATS, blankAd, customFormat, type AdFormat, type AdTemplateId } from '@/lib/ads/studio/templates';
import {
  DESIGN_KINDS, ID_OK, designInput,
  type DesignCopy, type DesignInput, type DesignKind, type DesignPage, type DesignRecord, type DesignScope, type DesignSource, type PageOrigin,
} from '@/lib/design/model';
import { sizePreset } from '@/lib/design/sizes';

export interface WorkPage extends DesignPage {
  doc: StoryDoc;
  /** Bumped when the document is set from outside the editor (see the header). */
  ver: number;
}

export interface DesignWork {
  /** The saved design's id (`saved:<id>` for a legacy ad opened and not yet saved over); null before the first save. */
  id: string | null;
  name: string;
  folder: string | null;
  kind: DesignKind;
  scope: DesignScope;
  source?: DesignSource;
  fields: Fields;
  copy: DesignCopy;
  pages: WorkPage[];
  master: string;
  active: string;
  /** Resized pages whose master changed since they were made. */
  stale: string[];
  /** Waiting for its photo and the house's marks to lay the pages out. */
  fresh: boolean;
  /** Changed since it was last saved to the shop. */
  dirty: boolean;
  template: AdTemplateId;
}

export const emptyFields = (): Fields => ({ kicker: '', headline: '', weight: '', details: '' });

// ── What each kind starts as ───────────────────────────────────────────────

export interface KindCard {
  kind: DesignKind;
  title: string;
  note: string;
  /** SIZE_PRESETS ids the kind starts with. */
  sizes: string[];
  /** Owner and marketing only. */
  ads?: boolean;
}

export const KIND_CARDS: KindCard[] = [
  { kind: 'piece', title: 'A piece', note: 'Story and post together', sizes: ['story', 'whatsapp'] },
  { kind: 'post', title: 'Post', note: 'Square, for the feed', sizes: ['square'] },
  { kind: 'story', title: 'Story', note: '9:16', sizes: ['story'] },
  { kind: 'whatsapp', title: 'WhatsApp', note: 'Square, for groups', sizes: ['whatsapp'] },
  { kind: 'site', title: 'Website photo', note: 'Square, for the site', sizes: ['website'] },
  { kind: 'ad', title: 'Ad', note: 'Meta’s feed sizes', sizes: ['portrait'], ads: true },
  { kind: 'custom', title: 'Any size', note: 'Your own W:H', sizes: ['square'] },
];

export const kindCard = (k: DesignKind): KindCard => KIND_CARDS.find(c => c.kind === k) ?? KIND_CARDS[1];
export const scopeOfKind = (k: DesignKind): DesignScope => (k === 'ad' ? 'ads' : 'shop');
export const kindLabel = (k: DesignKind): string => ({ piece: 'Piece', ad: 'Ad', story: 'Story', post: 'Post', whatsapp: 'WhatsApp', site: 'Website', custom: 'Custom' })[k];

/** The sections of the page, and who sees them: the Board is the ad studio's, so owner and marketing only. */
export const SECTIONS = [
  { key: 'make', label: 'Make', ads: false },
  { key: 'photos', label: 'Photos', ads: false },
  { key: 'board', label: 'Board', ads: true },
  { key: 'saved', label: 'Saved', ads: false },
] as const;
export type SectionKey = (typeof SECTIONS)[number]['key'];
export const sectionsFor = (adsOk: boolean) => SECTIONS.filter(s => adsOk || !s.ads);
export const sectionOf = (v: string | null | undefined, adsOk: boolean): SectionKey => sectionsFor(adsOk).find(s => s.key === v)?.key ?? 'make';

export const PHOTO_PARTS = [
  { key: 'site', label: 'The website', ads: false },
  { key: 'picks', label: 'Best for ads', ads: true },
  { key: 'library', label: 'Every photo', ads: true },
] as const;
export type PhotoPart = (typeof PHOTO_PARTS)[number]['key'];
export const photoPartsFor = (adsOk: boolean) => PHOTO_PARTS.filter(p => adsOk || !p.ads);
export const photoPartOf = (s: string | null | undefined, adsOk: boolean): PhotoPart => photoPartsFor(adsOk).find(p => p.key === s)?.key ?? 'site';

// ── Pages ──────────────────────────────────────────────────────────────────

export function nextPageId(pages: { id: string }[]): string {
  let n = pages.length + 1;
  while (pages.some(p => p.id === `p${n}`)) n++;
  return `p${n}`;
}

export interface SizeChoice { id: string; custom?: { w: number; h: number } }

/** The frame, format and label of a size choice (a SIZE_PRESETS id, or a custom W:H). */
export function sizeOf(c: SizeChoice): { label: string; format: AdFormat; frame: Frame; px: number; ratio: string } {
  if (c.id === 'custom') {
    const f = customFormat(c.custom?.w ?? 1, c.custom?.h ?? 1);
    return { label: f.label, format: 'custom', frame: f.frame, px: f.px, ratio: f.short };
  }
  const p = sizePreset(c.id);
  if (p) return { label: p.label, format: p.format, frame: p.frame, px: p.px, ratio: p.ratio };
  const f = AD_FORMATS.square;
  return { label: f.label, format: 'square', frame: f.frame, px: f.px, ratio: f.short };
}

export interface NewWork {
  kind: DesignKind;
  sizes: SizeChoice[];
  name?: string;
  fields?: Partial<Fields>;
  source?: DesignSource;
  template?: AdTemplateId;
  copy?: DesignCopy;
}

/** A design to start: its first size is the master, the others are made from it. Laid out once the photo is in. */
export function newWork(o: NewWork): DesignWork {
  const sizes = o.sizes.length ? o.sizes : kindCard(o.kind).sizes.map(id => ({ id }));
  const pages: WorkPage[] = [];
  for (const s of sizes) {
    const z = sizeOf(s);
    const id = nextPageId(pages);
    pages.push({
      id, label: z.label, format: z.format, frame: z.frame, rev: 0, ver: 0, doc: blankAd(z.format, z.frame),
      origin: pages.length ? 'resized' : 'master', ...(pages.length ? { syncedFrom: pages[0].id } : {}),
    });
  }
  return {
    id: null, name: o.name ?? '', folder: null, kind: o.kind, scope: scopeOfKind(o.kind), ...(o.source ? { source: o.source } : {}),
    fields: { ...emptyFields(), ...o.fields }, copy: o.copy ?? {}, pages, master: pages[0].id, active: pages[0].id,
    stale: [], fresh: true, dirty: false, template: o.template ?? 'headline',
  };
}

export const pageOf = (w: DesignWork, id: string): WorkPage | undefined => w.pages.find(p => p.id === id);
export const activePage = (w: DesignWork): WorkPage => pageOf(w, w.active) ?? w.pages[0];

const touch = (w: DesignWork, patch: Partial<DesignWork>): DesignWork => ({ ...w, ...patch, dirty: true });

// ── Edits ──────────────────────────────────────────────────────────────────

/** The editor changed a page's document. */
export function editDoc(w: DesignWork, pageId: string, doc: StoryDoc): DesignWork {
  const page = pageOf(w, pageId);
  if (!page || page.doc === doc) return w;
  const isMaster = pageId === w.master;
  const pages = w.pages.map(p => (p.id === pageId ? { ...p, doc, rev: p.rev + 1, origin: isMaster ? p.origin : ('manual' satisfies PageOrigin) } : p));
  // The master moved: the pages made from it are behind. A page edited by hand is the person's own, so it is not.
  const behind = isMaster ? pages.filter(p => p.origin === 'resized' && p.syncedFrom === w.master).map(p => p.id) : [];
  const stale = isMaster ? [...new Set([...w.stale, ...behind])] : w.stale.filter(id => id !== pageId);
  return touch(w, { pages, stale });
}

/** A document set from outside the editor (a layout, a re-do, a resize): the editor starts over from it. */
export function setDoc(w: DesignWork, pageId: string, doc: StoryDoc, patch: Partial<Pick<WorkPage, 'origin' | 'syncedFrom'>> = {}): DesignWork {
  if (!pageOf(w, pageId)) return w;
  return touch(w, { pages: w.pages.map(p => (p.id === pageId ? { ...p, ...patch, doc, ver: p.ver + 1, rev: p.rev + 1 } : p)) });
}

/** "Re-do from master" on a resized page: it takes the document made from the master and is in step again. */
export function redoFromMaster(w: DesignWork, pageId: string, doc: StoryDoc): DesignWork {
  return setDoc({ ...w, stale: w.stale.filter(id => id !== pageId) }, pageId, doc, { origin: 'resized', syncedFrom: w.master });
}

/** The first layout of a fresh design, or a new layout on every page: documents set, origins left as they are. */
export function layOutAll(w: DesignWork, make: (page: WorkPage) => StoryDoc, template: AdTemplateId = w.template): DesignWork {
  return {
    ...w, template, fresh: false, dirty: w.dirty || !w.fresh,
    pages: w.pages.map(p => ({ ...p, doc: make(p), ver: p.ver + 1 })),
  };
}

export interface NewPage { id?: string; label: string; format: AdFormat; frame: Frame; doc: StoryDoc; origin?: PageOrigin; syncedFrom?: string }

/** Pages from the resize sheet (or one made for a destination): ids made unique, `resized` from the master unless it says. */
export function addPages(w: DesignWork, incoming: NewPage[]): DesignWork {
  if (!incoming.length) return w;
  let pages = [...w.pages];
  for (const n of incoming) {
    if (pages.length >= 24) break;
    const id = n.id && ID_OK.test(n.id) && !pages.some(p => p.id === n.id) ? n.id : nextPageId(pages);
    const origin = n.origin ?? 'resized';
    const syncedFrom = n.syncedFrom ?? (origin === 'resized' ? w.master : undefined);
    pages = [...pages, { id, label: n.label.slice(0, 60), format: n.format, frame: n.frame, doc: n.doc, rev: 0, ver: 0, origin, ...(syncedFrom ? { syncedFrom } : {}) }];
  }
  const last = pages[pages.length - 1];
  return touch(w, { pages, active: last.id });
}

export function removePage(w: DesignWork, pageId: string): DesignWork {
  if (w.pages.length <= 1 || !pageOf(w, pageId)) return w;
  const pages = w.pages.filter(p => p.id !== pageId);
  const master = w.master === pageId ? pages[0].id : w.master;
  // A page made from the one that went has nothing to follow: it stands on its own.
  const fixed = pages.map((p): WorkPage => {
    if (w.master === pageId && p.id === master) return { ...p, origin: 'master', syncedFrom: undefined };
    if (p.syncedFrom === pageId) return { ...p, origin: 'manual', syncedFrom: undefined };
    return p;
  });
  return touch(w, { pages: fixed, master, active: w.active === pageId ? master : w.active, stale: w.stale.filter(id => id !== pageId && id !== master) });
}

export const setActive = (w: DesignWork, pageId: string): DesignWork => (pageOf(w, pageId) ? { ...w, active: pageId } : w);

/** Another page is the master: pages that followed the old one follow this, and are behind until re-done. */
export function setMaster(w: DesignWork, pageId: string): DesignWork {
  if (pageId === w.master || !pageOf(w, pageId)) return w;
  const old = w.master;
  const pages = w.pages.map(p => {
    if (p.id === pageId) return { ...p, origin: 'master' as const, syncedFrom: undefined };
    if (p.id === old) return { ...p, origin: 'manual' as const, syncedFrom: undefined };
    if (p.origin === 'resized' && p.syncedFrom === old) return { ...p, syncedFrom: pageId };
    return p;
  });
  const behind = pages.filter(p => p.origin === 'resized' && p.syncedFrom === pageId).map(p => p.id);
  return touch(w, { pages, master: pageId, stale: [...new Set(behind)] });
}

export const setFields = (w: DesignWork, f: Partial<Fields>): DesignWork => touch(w, { fields: { ...w.fields, ...f } });
export const setCopy = (w: DesignWork, c: Partial<DesignCopy>): DesignWork => touch(w, { copy: { ...w.copy, ...c } });
export const rename = (w: DesignWork, name: string): DesignWork => touch(w, { name: name.slice(0, 120) });
export const refile = (w: DesignWork, folder: string | null): DesignWork => touch(w, { folder });
export const markSaved = (w: DesignWork, id: string, folder: string | null): DesignWork => ({ ...w, id, folder, dirty: false });

/** A page of the design for the strip, publish sheet and save: without its document. */
export const toPage = ({ doc: _doc, ver: _ver, ...p }: WorkPage): DesignPage => p;

// ── To and from records ────────────────────────────────────────────────────

export const displayName = (w: DesignWork): string => w.name.trim() || w.fields.headline.trim() || 'Untitled design';

/** What a save carries (cleaned again by the server). */
export function toInput(w: DesignWork, thumb: string): DesignInput | null {
  return designInput({
    name: displayName(w), folder: w.folder, kind: w.kind, scope: w.scope, source: w.source, fields: w.fields, copy: w.copy,
    pages: w.pages.map(toPage), master: w.master, thumb,
  });
}

/** The work as the record the publish sheet reads, before (or without) a save. */
export function toRecordLike(w: DesignWork, by = ''): DesignRecord {
  const now = new Date().toISOString();
  return {
    id: w.id ?? '', name: displayName(w), folder: w.folder, kind: w.kind, scope: w.scope, ...(w.source ? { source: w.source } : {}),
    fields: w.fields, copy: w.copy, pages: w.pages.map(toPage), master: w.master, files: {}, thumb: '', published: [], at: now, updated: now, by, rev: 0,
  };
}

/** A saved design opened: its record and each page's document. */
export function fromRecord(r: DesignRecord, docs: Record<string, StoryDoc>, template: AdTemplateId = 'headline'): DesignWork | null {
  const pages: WorkPage[] = [];
  for (const p of r.pages) {
    const doc = docs[p.id];
    if (!doc) return null;
    pages.push({ ...p, doc, ver: 0 });
  }
  if (!pages.length) return null;
  const master = pages.some(p => p.id === r.master) ? r.master : pages[0].id;
  return {
    id: r.id, name: r.name, folder: r.folder, kind: r.kind, scope: r.scope, ...(r.source ? { source: r.source } : {}),
    fields: { ...emptyFields(), ...r.fields }, copy: r.copy ?? {}, pages, master, active: master,
    stale: [], fresh: false, dirty: false, template: (pages.find(p => p.id === master)?.doc.meta?.template as AdTemplateId | undefined) ?? template,
  };
}

// ── The device draft ───────────────────────────────────────────────────────

/** What a device draft keeps of the work (its photo is stored beside it). `design: 1` tells it from a Post a piece draft. */
export interface DraftState { design: 1; work: Omit<DesignWork, 'fresh'> }

export const serializeWork = (w: DesignWork): DraftState => {
  const { fresh: _f, ...rest } = w;
  return { design: 1, work: rest };
};

export const isDesignDraft = (s: unknown): s is DraftState =>
  !!s && typeof s === 'object' && (s as DraftState).design === 1 && !!(s as DraftState).work && Array.isArray((s as DraftState).work.pages);

/** A draft read back, validated as a save would be (a draft from another version that doesn't fit is not opened). */
export function deserializeWork(s: unknown): DesignWork | null {
  if (!isDesignDraft(s)) return null;
  const w = s.work;
  if (!DESIGN_KINDS.includes(w.kind) || !w.pages.length || !w.pages.every(p => p && typeof p.id === 'string' && p.doc && p.frame)) return null;
  const master = w.pages.some(p => p.id === w.master) ? w.master : w.pages[0].id;
  const active = w.pages.some(p => p.id === w.active) ? w.active : master;
  return { ...w, master, active, fresh: false, pages: w.pages.map(p => ({ ...p, ver: 0 })), stale: (w.stale ?? []).filter(id => w.pages.some(p => p.id === id)) };
}
