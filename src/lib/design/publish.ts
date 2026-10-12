/**
 * Sending a design out (docs/features/design-studio-plan.md §5.3), client side. The call shapes are the ones the
 * old surfaces made — Post a piece's publish steps (`website/post/page.tsx`), the ad maker's Post it
 * (`ads/studio/post-it.tsx`) and the Board's queuePost / toNewAd / saveToSaved — gathered once. Nothing
 * server-side changes: WhatsApp goes through POST /api/website/post (so the community twin keeps mirroring),
 * the website through the Add photos relay, a story through /api/instagram/story, a feed post through
 * /api/instagram/post, a queued piece through the queue routes.
 *
 * The contract (the one `post-drafts.ts` and `queue.ts sendItem` keep): every send is a *step* with an id; a
 * step that succeeded leaves its result in `memory` and is never run again, so running the plan a second time
 * retries only the steps that failed — a group is never posted twice. WhatsApp is a step per place.
 *
 * Pure of React and of the browser's globals except where a sender needs `fetch` / `FileReader` (and those are
 * injected in tests).
 */

import type { DesignCopy, DesignKind, DesignPage, DesignSource, DestinationId, PublishEntry } from './model';
import type { Fields } from '@/lib/social/editor';
import { breaksHouseRule, inventedFigures } from '@/lib/ads/studio/prompts';
import { HANDOFF_PREFIX, type StudioHandoff } from '@/lib/ads/studio/handoff';
import { makeLabel, needsFor, outputPx, pageFor, storyPage, type InstagramMode } from './destinations';
import type { SizePreset } from './sizes';
import { websiteFileName } from '@/lib/social/caption';
import { isMaisonFolder, maisonFileName } from '@/lib/website/maisons';

// ── What is being sent ───────────────────────────────────────────────────────

export interface PublishDesign {
  /** Absent until the design is saved; the Save step (or the shell) gives it one. */
  id?: string;
  name: string;
  kind: DesignKind;
  fields: Fields;
  copy: DesignCopy;
  source?: DesignSource;
  /** The page that leads (a destination takes it when its shape fits). */
  master: string;
  folder?: string | null;
}

/** The sheet's choices. Off is `undefined`/`null`/empty. */
export interface Choices {
  /**
   * Add photos: a collection folder ("Earrings/Jhumki"). `name` is what the site calls the piece (its file name — the
   * headline when empty); in The Maisons, `house` is the great house the piece belongs to and `name` its official name.
   */
  website?: { folder: string; name?: string; house?: string } | null;
  /** The home page's set of the day (needs `website`). */
  featured?: boolean;
  /** WhatsApp places by key — a group's key, or "channel". */
  whatsapp?: string[];
  /** 'api' posts by the house's connection; 'share' waits for the phone's share sheet. */
  instagramStory?: InstagramMode | null;
  instagramPost?: InstagramMode | null;
  metaAd?: boolean;
  /** Replace the photo of the site piece this design came from. */
  siteReplace?: boolean;
  /** Save the design (needs `docOf`). */
  save?: boolean;
  /** Hold the website/WhatsApp/story sends in the post queue: `dueAt` null holds them, an ISO time schedules. */
  queue?: { dueAt: string | null } | null;
  captions: { wa: string; ig: string; adText: string; adHeadline: string };
}

export interface PlanContext {
  design: PublishDesign;
  pages: DesignPage[];
  /** The page drawn at a width, as a JPEG. */
  render: (pageId: string, px: number) => Promise<Blob>;
  /** A page's layout document, for Save and Replace-a-site-photo. */
  docOf?: (pageId: string) => unknown;
  /** The weight is printed on the picture (Replace-a-site-photo says so to the site). */
  stamped?: boolean;
  /** Where the Meta ad's button goes. */
  link?: string;
  /**
   * More photographs of the same piece (other angles): the website and WhatsApp get each as a square of its own, named
   * "<name> 2.jpg" and following, the caption riding on the first picture only. `render` draws page `pageId` over photograph
   * number `index` (1 is the first of these).
   */
  more?: { count: number; render: (pageId: string, index: number, px: number) => Promise<Blob> };
  senders: Senders;
}

export type Memory = Record<string, string>;

export interface PublishStep {
  id: string;
  dest: DestinationId | 'save' | 'queue';
  label: string;
  /** Steps whose results this one needs (the set of the day needs the website's photo). */
  after?: string[];
  /** Not run by `runSteps`: it waits for the person's own tap (the phone's share sheet). */
  manual?: boolean;
  /** For a manual step: the picture to hand to the share sheet. */
  share?: () => Promise<{ blob: Blob; name: string }>;
  /** Draws what it needs (cached) and sends; resolves to what came back. */
  run: (memory: Memory) => Promise<string>;
}

export interface MissingSize { dest: DestinationId; size: SizePreset; label: string }
export interface Plan { steps: PublishStep[]; missing: MissingSize[] }

// ── Senders: how one send goes out ───────────────────────────────────────────

export interface QueueRequest {
  headline: string;
  caption: string;
  fileBase: string;
  sitePiece?: string;
  website: { folder: string; name: string; names?: string[]; featured: boolean } | null;
  whatsapp: string[];
  /** How many squares the website and WhatsApp get (the piece and its other photographs). */
  count?: number;
  /** The images the queue holds, by the queue's own keys: 'site-0', 'wa-0', 'story'. */
  images: Record<string, Blob>;
  thumb: Blob | null;
  dueAt: string | null;
}
export interface SaveRequest {
  design: PublishDesign;
  pages: DesignPage[];
  images: Record<string, Blob>;
  docs: Record<string, unknown>;
  thumb: string;
}
export interface MetaRequest { main: Blob; vertical: Blob | null; name: string; headline: string; text: string; goal: string; link?: string; format: string }

export interface Senders {
  website(blob: Blob, folder: string, name: string): Promise<string>;
  featured(rel: string): Promise<string>;
  whatsapp(key: string, blob: Blob, name: string, caption: string, sitePiece?: string): Promise<string>;
  story(blob: Blob, name: string): Promise<string>;
  post(blob: Blob, caption: string): Promise<string>;
  siteReplace(siteId: string, blob: Blob, o: { stamped: boolean; doc?: unknown }): Promise<string>;
  /** Puts the ad in the ad account's library and leaves the handoff for /ads/new; resolves to the address to open. */
  metaAd(r: MetaRequest): Promise<string>;
  queue(r: QueueRequest): Promise<string>;
  /** Saves the design; resolves to its id. */
  save(r: SaveRequest): Promise<string>;
  /** Notes a successful send on the design. Never throws into a step. */
  record(designId: string, entry: Pick<PublishEntry, 'dest' | 'ok' | 'ref'>): Promise<void>;
}

/** An Error that remembers the HTTP status it came with (for diagnose()). */
export class PublishError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = 'PublishError'; }
}

// ── Building the plan ────────────────────────────────────────────────────────

const slug = (s: string) => (s.replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60)) || 'design';

/** Draws each (page, width) once, however many places want it; a retry reuses it. */
export function cachedRender(render: PlanContext['render']): PlanContext['render'] {
  const seen = new Map<string, Promise<Blob>>();
  return (pageId, px) => {
    const key = `${pageId}@${px}`;
    let p = seen.get(key);
    if (!p) { p = render(pageId, px); p.catch(() => seen.delete(key)); seen.set(key, p); }
    return p;
  };
}

/**
 * The steps for these choices, in the order they go: save, website, set of the day, story, post, each WhatsApp
 * place, the Meta ad, the website replacement — or, with `queue`, the website/story/WhatsApp ones as a single
 * queue step. A choice whose place has no page of its shape is not a step: it comes back in `missing`, with the
 * size to make ("Make 1:1 from this").
 */
export function buildPlan(ctx: PlanContext, c: Choices): Plan {
  const { design, pages, senders } = ctx;
  const render = cachedRender(ctx.render);
  const steps: PublishStep[] = [];
  const missing: MissingSize[] = [];
  const base = slug(design.fields.headline || design.name);
  const sitePiece = design.source?.siteId;
  // The site reads a piece's name from its file name, so it is written the way the site shows it ("Bangle and Ring.jpg"),
  // and a Maisons piece as "<House> — <Model>.jpg" (lib/website/maisons.ts).
  const siteFile = (i = 0): string => {
    const w = c.website;
    const name = (w?.name?.trim() || design.fields.headline || design.name).trim();
    return w && isMaisonFolder(w.folder) && w.house ? maisonFileName(w.house, name, i) : websiteFileName(name, i);
  };
  const more = ctx.more && ctx.more.count > 0 ? ctx.more : null;
  const extras = more ? Array.from({ length: more.count }, (_, k) => k + 1) : [];
  const pageOf = (dest: DestinationId) => {
    const pick = pageFor(pages, design.master, dest);
    if ('page' in pick) return pick.page;
    if (!missing.some(m => m.dest === dest)) missing.push({ dest, size: pick.missing, label: makeLabel(pick.missing) });
    return null;
  };
  const draw = (dest: DestinationId, page: DesignPage) => render(page.id, outputPx(dest, page));
  const queued = !!c.queue;

  const website = c.website && pageOf('website');
  const wa = (c.whatsapp ?? []).filter(k => k !== 'channel');
  const channel = (c.whatsapp ?? []).includes('channel');
  const waPage = wa.length || channel ? pageOf(wa.length ? 'whatsapp' : 'channel') : null;
  const storyDest = c.instagramStory ? pageOf('instagram-story') : null;
  const postDest = c.instagramPost ? pageOf('instagram-post') : null;
  const metaDest = c.metaAd ? pageOf('meta-ad') : null;
  const replaceDest = c.siteReplace && sitePiece ? pageOf('site-replace') : null;
  const featuredPage = c.website && c.featured ? website : null;

  if (c.save && ctx.docOf) {
    steps.push({
      id: 'save', dest: 'save', label: 'Save the design',
      run: async () => {
        const images: Record<string, Blob> = {}, docs: Record<string, unknown> = {};
        for (const p of pages) { images[p.id] = await render(p.id, Math.min(1600, p.frame.w)); docs[p.id] = ctx.docOf!(p.id); }
        const thumb = await thumbOf(render, design.master);
        return senders.save({ design, pages, images, docs, thumb });
      },
    });
  }

  // The queue sends a story by the connection; one that waits for the share sheet is the person's, so it stays a step.
  const storyQueued = queued && c.instagramStory === 'api' ? storyDest : null;

  if (!queued && website && c.website) {
    const folder = c.website.folder;
    steps.push({ id: 'website', dest: 'website', label: 'Website', run: async () => senders.website(await draw('website', website), folder, siteFile()) });
    for (const i of extras) {
      steps.push({ id: `website:${i}`, dest: 'website', label: `Website · photo ${i + 1}`, after: ['website'], run: async () => senders.website(await more!.render(website.id, i, outputPx('website', website)), folder, siteFile(i)) });
    }
    if (featuredPage) {
      steps.push({ id: 'featured', dest: 'featured', label: 'Set of the day', after: ['website'], run: m => senders.featured(m.website) });
    }
  }
  if (storyDest && !storyQueued) {
    steps.push({
      id: 'instagram-story', dest: 'instagram-story', label: 'Instagram story', manual: c.instagramStory === 'share',
      share: async () => ({ blob: await draw('instagram-story', storyDest), name: `${base}-story.jpg` }),
      run: async () => senders.story(await draw('instagram-story', storyDest), `${base}-story.jpg`),
    });
  }
  // Each place its own step, so one that fails is retried alone — never a group twice.
  if (!queued && waPage) {
    for (const key of [...wa, ...(channel ? ['channel'] : [])]) {
      steps.push({
        id: `wa:${key}`, dest: key === 'channel' ? 'channel' : 'whatsapp', label: key === 'channel' ? 'WhatsApp channel' : `WhatsApp · ${key}`,
        // 1600 px: WhatsApp makes no preview for images over 3000 px and shrinks everything to about this anyway.
        run: async () => senders.whatsapp(key, await draw('whatsapp', waPage), `${base}.jpg`, c.captions.wa, sitePiece),
      });
      // The other photographs follow the first, with no caption of their own.
      for (const i of extras) {
        steps.push({
          id: `wa:${key}:${i}`, dest: key === 'channel' ? 'channel' : 'whatsapp', label: `${key === 'channel' ? 'WhatsApp channel' : `WhatsApp · ${key}`} · photo ${i + 1}`, after: [`wa:${key}`],
          run: async () => senders.whatsapp(key, await more!.render(waPage.id, i, outputPx('whatsapp', waPage)), `${base}-${i + 1}.jpg`, '', sitePiece),
        });
      }
    }
  }
  if (queued && (website || waPage || storyQueued)) {
    // One queue entry carries the website, WhatsApp and story sends; the tick (or "send now") makes them, and
    // retries only what failed (queue.ts sendItem).
    steps.push({
      id: 'queue', dest: 'queue', label: c.queue!.dueAt ? 'Schedule in the post queue' : 'Hold in the post queue',
      run: async () => {
        const images: Record<string, Blob> = {};
        if (website) images['site-0'] = await draw('website', website);
        if (waPage) images['wa-0'] = await draw('whatsapp', waPage);
        for (const i of extras) {
          if (website) images[`site-${i}`] = await more!.render(website.id, i, outputPx('website', website));
          if (waPage) images[`wa-${i}`] = await more!.render(waPage.id, i, outputPx('whatsapp', waPage));
        }
        if (storyQueued) images.story = await draw('instagram-story', storyQueued);
        const lead = website ?? waPage ?? storyQueued!;
        return senders.queue({
          headline: design.fields.headline || design.name, caption: c.captions.wa, fileBase: base, sitePiece,
          website: website && c.website ? { folder: c.website.folder, name: siteFile(), names: [0, ...extras].map(siteFile), featured: !!featuredPage } : null,
          count: 1 + extras.length,
          whatsapp: waPage ? [...wa, ...(channel ? ['channel'] : [])] : [],
          images, thumb: await render(lead.id, 240).catch(() => null), dueAt: c.queue!.dueAt,
        });
      },
    });
  }

  // A feed post is never queued (the queue carries stories): it goes now, whichever way the rest goes.
  if (postDest) {
    steps.push({
      id: 'instagram-post', dest: 'instagram-post', label: 'Instagram post', manual: c.instagramPost === 'share',
      share: async () => ({ blob: await draw('instagram-post', postDest), name: `${base}-post.jpg` }),
      run: async () => senders.post(await draw('instagram-post', postDest), c.captions.ig),
    });
  }

  if (metaDest) {
    steps.push({
      id: 'meta-ad', dest: 'meta-ad', label: 'Meta ad',
      run: async () => {
        // One ad, both sizes: a feed-shaped main picture gets the 9:16 page as its second asset.
        const feed = metaDest.format === 'portrait' || metaDest.format === 'square';
        const story = feed ? storyPage(pages) : undefined;
        return senders.metaAd({
          main: await draw('meta-ad', metaDest), vertical: story ? await render(story.id, 1080) : null,
          name: design.name, headline: c.captions.adHeadline || design.fields.headline,
          text: c.captions.adText || [design.fields.headline, design.fields.weight, design.fields.details].filter(Boolean).join('\n'),
          goal: design.copy.goal ?? 'whatsapp', link: design.copy.link || ctx.link, format: metaDest.format,
        });
      },
    });
  }
  if (replaceDest && sitePiece) {
    steps.push({
      id: 'site-replace', dest: 'site-replace', label: 'Replace the photo on the website',
      run: async () => senders.siteReplace(sitePiece, await draw('site-replace', replaceDest), { stamped: !!ctx.stamped, doc: ctx.docOf?.(replaceDest.id) }),
    });
  }
  return { steps, missing };
}

async function thumbOf(render: PlanContext['render'], pageId: string): Promise<string> {
  const blob = await render(pageId, 200).catch(() => null);
  return blob ? blobToDataUrl(blob).catch(() => '') : '';
}

// ── Running it ───────────────────────────────────────────────────────────────

export type StepStatus = 'waiting' | 'running' | 'done' | 'failed' | 'manual';
export interface StepState { id: string; label: string; dest: PublishStep['dest']; status: StepStatus; ref?: string; error?: string; errStatus?: number }

export const initialStates = (steps: PublishStep[], memory: Memory): StepState[] =>
  steps.map(s => ({ id: s.id, label: s.label, dest: s.dest, status: memory[s.id] !== undefined ? 'done' : s.manual ? 'manual' : 'waiting', ...(memory[s.id] !== undefined ? { ref: memory[s.id] } : {}) }));

/**
 * Runs what is left. A step with a result in `memory` is done and skipped; a manual step waits for the
 * person; a step whose `after` has no result fails without running; the others run one at a time, each
 * result going into `memory` before the next begins (and onto the design's publish list). A failure does not
 * stop the rest. Call it again with the same `memory` to retry only the failures, or with `only` for one.
 */
export async function runSteps(
  steps: PublishStep[],
  memory: Memory,
  hooks: { onState?: (s: StepState) => void; record?: (step: PublishStep, ref: string) => Promise<void>; only?: string } = {},
): Promise<StepState[]> {
  const states = new Map(initialStates(steps, memory).map(s => [s.id, s]));
  const set = (id: string, patch: Partial<StepState>) => {
    const s = { ...states.get(id)!, ...patch };
    states.set(id, s);
    hooks.onState?.(s);
  };
  for (const step of steps) {
    if (hooks.only && step.id !== hooks.only) continue;
    if (memory[step.id] !== undefined || step.manual) continue;
    const blocked = step.after?.find(a => memory[a] === undefined);
    if (blocked) {
      const dep = steps.find(s => s.id === blocked);
      set(step.id, { status: 'failed', error: `${dep?.label ?? 'The step before it'} has not gone yet.` });
      continue;
    }
    set(step.id, { status: 'running', error: undefined, errStatus: undefined });
    try {
      const ref = (await step.run(memory)) || 'sent';
      memory[step.id] = ref;
      set(step.id, { status: 'done', ref });
      await hooks.record?.(step, ref).catch(() => undefined);
    } catch (e) {
      const status = (e as { status?: unknown })?.status;
      set(step.id, { status: 'failed', error: e instanceof Error ? e.message : String(e), ...(typeof status === 'number' ? { errStatus: status } : {}) });
    }
  }
  return [...states.values()];
}

/** The person did the step themselves (shared the story from the phone). */
export const markDone = (memory: Memory, id: string, ref = 'shared') => { memory[id] = ref; };

/** The memory of a half-finished send, kept in this tab so a reload doesn't forget what went. */
export function loadMemory(key: string): Memory {
  try { const v = JSON.parse(sessionStorage.getItem(`design_publish:${key}`) || '{}'); return v && typeof v === 'object' ? v as Memory : {}; } catch { return {}; }
}
export function saveMemory(key: string, memory: Memory): void {
  try { sessionStorage.setItem(`design_publish:${key}`, JSON.stringify(memory)); } catch { /* fine */ }
}

// ── Words ────────────────────────────────────────────────────────────────────

/**
 * The house rules on the words that will go out (the same two the ad studio holds copy to): sale/discount
 * words and hashtags, and figures the ERP's own specs line did not give. Empty when they pass.
 */
export function wordProblems(texts: Record<string, string>, facts: string): string[] {
  const out: string[] = [];
  for (const [where, text] of Object.entries(texts)) {
    if (!text.trim()) continue;
    if (breaksHouseRule(text)) out.push(`The ${where} has sale or discount words, or a hashtag.`);
    const made = inventedFigures(text, facts);
    if (made.length) out.push(`The ${where} has ${made.join(', ')}, which the specs line doesn’t give.`);
  }
  return out;
}

/** Which of the plan's destinations a failing check blocks (the HealthPanel's groups). */
export const checkGroupOf = (dest: PublishStep['dest']): 'Website' | 'WhatsApp' | 'Instagram' | null =>
  dest === 'website' || dest === 'featured' || dest === 'site-replace' ? 'Website'
    : dest === 'whatsapp' || dest === 'channel' ? 'WhatsApp'
      : dest === 'instagram-story' || dest === 'instagram-post' ? 'Instagram' : null;

// ── The real senders ─────────────────────────────────────────────────────────

export const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const file = (b: Blob, name: string) => new File([b], name, { type: 'image/jpeg' });

/** The senders that call this app's routes. `headers` is the signed-in person's (ads-kit `authHeaders`). */
export function httpSenders(headers: () => Promise<Record<string, string>>, fetchFn: typeof fetch = (...a) => fetch(...a)): Senders {
  async function call<T extends Record<string, unknown>>(path: string, init: { method?: string; form?: FormData; json?: unknown } = {}): Promise<T> {
    const h = await headers();
    if (init.json !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetchFn(path, { method: init.method ?? (init.form || init.json !== undefined ? 'POST' : 'GET'), headers: h, body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined), cache: 'no-store' });
    const d = await res.json().catch(() => ({})) as T & { error?: string };
    if (!res.ok) throw new PublishError(d.error || `Failed (${res.status})`, res.status);
    return d;
  }
  return {
    website: async (blob, folder, name) => {
      const f = new FormData();
      f.set('folder', folder); f.set('name', name); f.set('file', file(blob, name));
      const d = await call<{ rel?: string }>('/api/website/photos', { form: f });
      return d.rel || 'uploaded';
    },
    featured: async rel => { await call('/api/website/featured', { method: 'PUT', json: { key: rel } }); return rel; },
    whatsapp: async (key, blob, name, caption, sitePiece) => {
      const f = new FormData();
      f.set('file', file(blob, name));
      if (caption) f.set('caption', caption);
      f.set('targets', key);
      if (sitePiece) f.set('sitePiece', sitePiece);
      const d = await call<{ idMessage?: string }>('/api/website/post', { form: f });
      return d.idMessage || 'sent';
    },
    story: async (blob, name) => {
      const f = new FormData();
      f.set('file', file(blob, name));
      return (await call<{ mediaId?: string }>('/api/instagram/story', { form: f })).mediaId || 'posted';
    },
    post: async (blob, caption) => {
      const f = new FormData();
      f.set('file', file(blob, 'post.jpg'));
      if (caption.trim()) f.set('caption', caption.trim());
      return (await call<{ mediaId?: string }>('/api/instagram/post', { form: f })).mediaId || 'posted';
    },
    siteReplace: async (siteId, blob, o) => {
      const f = new FormData();
      f.set('id', siteId); f.set('file', file(blob, 'photo.jpg')); f.set('stamped', o.stamped ? '1' : '0');
      if (o.doc !== undefined) f.set('design', JSON.stringify(o.doc));
      f.set('shape', 'own'); f.set('ai', '[]');
      await call('/api/website/edits', { form: f });
      return siteId;
    },
    metaAd: async r => {
      const upload = (b: Blob, name: string) => { const f = new FormData(); f.set('file', b, name); return call<{ hash: string; url: string | null }>('/api/ads/images', { form: f }); };
      const base = slug(r.headline || r.name);
      const [up, vert] = await Promise.all([upload(r.main, `${base}.jpg`), r.vertical ? upload(r.vertical, `${base}-9x16.jpg`) : Promise.resolve(null)]);
      await call('/api/ads/studio/creatives', { json: { assets: [], hash: up.hash, url: up.url, format: r.format, name: r.headline } }).catch(() => undefined);
      const key = Math.random().toString(36).slice(2, 10);
      const handoff: StudioHandoff = {
        photos: [{ hash: up.hash, url: up.url, headline: r.headline, link: r.link }],
        vertical: vert ? { hash: vert.hash, url: vert.url } : null,
        text: r.text, headline: r.headline, goal: r.goal as StudioHandoff['goal'], ...(r.link ? { link: r.link } : {}),
        name: `${r.name}${vert ? ' + 9:16' : ''}`,
      };
      sessionStorage.setItem(HANDOFF_PREFIX + key, JSON.stringify(handoff));
      return `/ads/new?studio=${key}`;
    },
    queue: async r => {
      let qid: string | null = null;
      try {
        const counts = { site: r.website ? r.count ?? 1 : 0, wa: r.whatsapp.length ? r.count ?? 1 : 0, story: 'story' in r.images };
        const thumb = r.thumb ? (await blobToDataUrl(r.thumb)).split(',')[1] : undefined;
        const { item } = await call<{ item: { id: string } }>('/api/website/post/queue', { json: {
          headline: r.headline, caption: r.caption, fileBase: r.fileBase, counts,
          website: r.website ? { folder: r.website.folder, collection: r.website.folder.split('/')[1] ?? r.website.folder, names: r.website.names ?? [r.website.name], featured: r.website.featured } : null,
          instagram: counts.story, whatsapp: r.whatsapp, ...(thumb ? { thumb } : {}), ...(r.sitePiece ? { sitePiece: r.sitePiece } : {}),
        } });
        qid = item.id;
        for (const [key, b] of Object.entries(r.images)) {
          const f = new FormData();
          f.set('key', key); f.set('file', file(b, `${key}.jpg`));
          await call(`/api/website/post/queue/${qid}`, { form: f });
        }
        // 'ready' puts the draft in the queue, held; a time then schedules it.
        await call(`/api/website/post/queue/${qid}`, { method: 'PATCH', json: { action: 'ready' } });
        if (r.dueAt) await call(`/api/website/post/queue/${qid}`, { method: 'PATCH', json: { action: 'schedule', dueAt: r.dueAt } });
        return qid;
      } catch (e) {
        // Nothing has gone: take the half-made entry out so the retry starts clean.
        if (qid) call(`/api/website/post/queue/${qid}`, { method: 'DELETE' }).catch(() => undefined);
        throw e;
      }
    },
    save: async r => {
      const kind = r.design.kind;
      const f = new FormData();
      f.set('meta', JSON.stringify({
        name: r.design.name, folder: r.design.folder ?? null, kind, scope: kind === 'ad' ? 'ads' : 'shop', source: r.design.source,
        fields: r.design.fields, copy: r.design.copy, pages: r.pages, master: r.design.master, thumb: r.thumb,
      }));
      if (r.design.id) f.set('id', r.design.id);
      for (const p of r.pages) {
        if (r.images[p.id]) f.set(`image:${p.id}`, file(r.images[p.id], 'image.jpg'));
        f.set(`doc:${p.id}`, new File([JSON.stringify(r.docs[p.id] ?? null)], 'doc.json', { type: 'application/json' }));
      }
      const d = await call<{ item: { id: string } }>('/api/design/designs', { form: f });
      return d.item.id;
    },
    record: async (designId, entry) => {
      await call(`/api/design/designs/${encodeURIComponent(designId)}`, { method: 'PATCH', json: { published: entry } }).catch(e => console.warn('[design] could not note the send:', e));
    },
  };
}

// ── Download and share (the person's own device) ─────────────────────────────

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The phone's share sheet for a picture; resolves false when the device has none or the person closed it. */
export async function shareImage(blob: Blob, name: string): Promise<boolean> {
  const f = file(blob, name);
  try {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [f] })) return false;
    await navigator.share({ files: [f] });
    return true;
  } catch { return false; }
}

export { needsFor };
