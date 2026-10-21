/**
 * Posting for an outside AI (docs/features/ai-keys.md): find a piece or photograph, make a story and a post of
 * it in the house's own layouts, look at them, and put them in the queue — where they wait for the owner's
 * OK in Posts, unless the key may send (posts:publish).
 *
 * Nothing here is drawn or sent another way: a post is laid out and drawn by the server's copy of the
 * page's renderer (ads/studio/server-draw.ts, as the board agent's designs are), kept as a Design on the
 * Saved shelf (lib/design/store.ts, so the owner can open and change it in Posts › Design), queued and sent
 * by the queue (lib/social/queue.ts: the per-destination sends, the community twin, the send log).
 * The website is left to people (Design, Add photos): its collections, names and the Maisons are theirs.
 * Server-only.
 */

import sharp from 'sharp';
import { z } from 'zod';
import { BRAND } from '@/lib/ads/studio/brand';
import { AD_FORMATS, AD_TEMPLATES, type AdFormat, type AdTemplateId } from '@/lib/ads/studio/templates';
import { safeTemplate } from '@/lib/ads/studio/board-shape';
import { adScore } from '@/lib/ads/studio/assessment';
import { assetImage, assetJpeg, listAssets, loadAssessments, type StudioAsset } from '@/lib/ads/studio/assets';
import { assetsOf, drawJpeg, layOut } from '@/lib/ads/studio/server-draw';
import { fileKey, type DesignInput, type DesignPage, type DesignRecord } from '@/lib/design/model';
import { getDesign, listDesigns, readDesignFile, saveDesign } from '@/lib/design/store';
import { matchesRatio, pageFor } from '@/lib/design/destinations';
import { sitePieceCaption, whatsappCaption } from '@/lib/social/caption';
import { postChannel, postGroups } from '@/lib/social/destinations';
import { instagramConfigured, loadConnection } from '@/lib/social/instagram';
import { awaitingApproval, changeItem, claimItem, createItem, deleteItem, getItem, listItems, putMedia, sendItem, toView } from '@/lib/social/queue';
import { getSitePiece } from '@/lib/website/site-pieces';
import { STORE_POST_FOOTER, STORE_POST_METAL, STORE_POST_TAGLINE, STORE_WHATSAPP_NUMBERS } from '@/lib/store-config';
import { copyProblems } from './house-rules';
import { tool, ToolError, type AgentTool, type ToolImage } from './registry';

const DRAFT = ['posts:draft'] as const;
const PUBLISH = ['posts:publish'] as const;
const PHOTOS = ['posts:draft', 'read'] as const;

const TEMPLATE_IDS = AD_TEMPLATES.map(t => t.id) as [AdTemplateId, ...AdTemplateId[]];
const VIEW_PX = 720;

const jpeg = (data: Buffer): ToolImage => ({ data, mimeType: 'image/jpeg' });
const smaller = (b: Buffer, px = VIEW_PX) => sharp(b).resize(px, px, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();

async function findAsset(id: string): Promise<StudioAsset> {
  const asset = (await listAssets()).assets.find(a => a.id === id);
  if (!asset) throw new ToolError(`No photo “${id.slice(0, 80)}” — find_photos gives the ids.`, 404);
  return asset;
}

/** The facts the ERP has for a photograph: its specs line, and what the site says of the piece. */
async function pieceOf(asset: StudioAsset) {
  const site = asset.source === 'site' ? await getSitePiece(asset.key).catch(() => null) : null;
  return { site, facts: [asset.specs, site?.weightGrams ? `${site.weightGrams}g` : '', ...(site?.facts ?? [])].filter(Boolean).join(' · ') };
}

/** The caption the house would start from: the Posts hub's for a website piece, Post a piece's otherwise. */
function houseCaption(asset: StudioAsset, headline: string, site: Awaited<ReturnType<typeof pieceOf>>['site']): string {
  if (site) {
    return sitePieceCaption(
      { name: site.name, url: site.url, weightGrams: site.weightGrams, facts: site.facts, about: site.about },
      { metal: STORE_POST_METAL, tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER, whatsappNumbers: STORE_WHATSAPP_NUMBERS },
    );
  }
  return whatsappCaption({ headline }, { whatsappNumbers: STORE_WHATSAPP_NUMBERS, tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER, link: asset.page ?? undefined });
}

function refuseWords(words: Record<string, string | undefined>, facts: string, piece: { name: string; collection?: string }) {
  const bad = Object.entries(words).flatMap(([k, v]) => (v ? copyProblems(v, facts, piece).map(p => `${k}: ${p}`) : []));
  if (bad.length) throw new ToolError(`Not made — ${bad.join('; ')}.`, 422);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'post';

function destinations() {
  const groups = postGroups().map(g => ({ key: g.key, label: g.label }));
  const channel = postChannel();
  return { whatsapp: [...groups, ...(channel ? [{ key: channel.key, label: 'The WhatsApp channel' }] : [])] };
}

async function instagramReady(): Promise<{ ok: boolean; why?: string; username?: string }> {
  if (!instagramConfigured()) return { ok: false, why: 'This shop has no Instagram connection in the ERP (stories are shared by hand from the phone).' };
  const c = await loadConnection().catch(() => null);
  if (!c || Date.parse(c.expiresAt) <= Date.now()) return { ok: false, why: 'Instagram is not connected right now — the owner reconnects it in Posts › Design.' };
  return { ok: true, username: c.username };
}

async function designOf(id: string): Promise<DesignRecord> {
  const rec = /^[\w-]{1,40}$/.test(id) ? await getDesign(id) : null;
  if (!rec || rec.scope !== 'shop') throw new ToolError(`No post “${id.slice(0, 60)}” — list_posts gives the ids.`, 404);
  return rec;
}

async function pageImage(rec: DesignRecord, page: DesignPage): Promise<Buffer> {
  const img = await readDesignFile(rec, fileKey('image', page.id));
  if (!img) throw new ToolError(`“${rec.name}” has no picture of its ${page.label} saved; open it in Posts › Design and save it.`, 409);
  return img;
}

const queueRow = (d: ReturnType<typeof toView>) => ({
  id: d.id, headline: d.headline, status: d.status, awaitingApproval: d.awaitingApproval, madeBy: d.proposedBy ?? d.by,
  dueAt: d.dueAt, whatsapp: d.whatsapp, instagram: d.instagram, website: d.website?.collection ?? null,
  sentAt: d.sentAt ?? null, left: d.units.filter(u => !d.done[u]), errors: Object.values(d.errors ?? {}).map(e => e.message).slice(0, 3),
  design: d.design ?? null,
});

async function queued(id: string) {
  const item = /^[A-Za-z0-9]{10,40}$/.test(id) ? await getItem(id) : null;
  if (!item) throw new ToolError(`No queued post “${id.slice(0, 60)}” — list_queue gives the ids.`, 404);
  return item;
}

const FORMATS = { story: 'story', square: 'square' } as const satisfies Record<string, AdFormat>;

export const POST_TOOLS: AgentTool[] = [
  tool({
    name: 'find_photos', title: 'Find photographs', effect: 'read', scopes: [...PHOTOS],
    description: 'Search the photo library: the pieces on the website (with the ERP’s specs line: metal, karat, stones, weight), the shoots in the shared Drive, and uploads. Best ad photos first. Use the id with view_photo and make_post.',
    input: z.object({
      query: z.string().max(120).optional().describe('Words in the name, collection or subject, e.g. "emerald ring".'),
      collection: z.string().max(120).optional().describe('An exact collection name.'),
      source: z.enum(['site', 'drive', 'upload']).optional().describe('Only the website’s pieces, the Drive shoots, or uploads.'),
      limit: z.number().int().min(1).max(40).optional().describe('At most this many (default 12).'),
    }),
    run: async a => {
      const [lib, assessed] = await Promise.all([listAssets(), loadAssessments().catch(() => new Map())]);
      const words = (a.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const rows = lib.assets.filter(x => (!a.source || x.source === a.source) && (!a.collection || x.collection === a.collection))
        .map(x => ({ x, s: assessed.get(x.id)?.assessment ?? null }))
        .filter(({ x, s }) => words.every(w => `${x.name} ${x.collection} ${s?.subject ?? ''} ${s?.category ?? ''}`.toLowerCase().includes(w)))
        .sort((p, q) => (q.s ? adScore(q.s, 'portrait') : -1) - (p.s ? adScore(p.s, 'portrait') : -1) || (q.x.added ?? 0) - (p.x.added ?? 0))
        .slice(0, a.limit ?? 12)
        .map(({ x, s }) => ({ id: x.id, name: x.name, collection: x.collection, source: x.source, specs: x.specs, page: x.page, subject: s?.subject ?? null, adScore: s ? adScore(s, 'portrait') : null }));
      return { data: rows };
    },
  }),
  tool({
    name: 'view_photo', title: 'Look at a photograph', effect: 'read', scopes: [...PHOTOS],
    description: 'See a photograph from find_photos.',
    input: z.object({ id: z.string().min(3).max(200).describe('The photo id from find_photos.') }),
    run: async a => { await findAsset(a.id); return { text: a.id, images: [jpeg(await assetJpeg(a.id, 768))] }; },
  }),
  tool({
    name: 'list_destinations', title: 'Where posts can go', effect: 'read', scopes: [...DRAFT, ...PUBLISH],
    description: 'Where a queued post can go in this shop: the WhatsApp community’s groups and the channel (by key), and whether Instagram stories can be posted from the ERP.',
    input: z.object({}),
    run: async () => {
      const ig = await instagramReady();
      return { data: { ...destinations(), instagramStory: ig.ok ? { available: true, account: ig.username } : { available: false, why: ig.why }, website: 'Not from an AI: website pieces are added by a person in Posts › Design or Website › Add photos.' } };
    },
  }),
  tool({
    name: 'make_post', title: 'Make a post', effect: 'post', scopes: [...DRAFT],
    description: 'Make a story (9:16, for Instagram) and/or a square post (1:1, for WhatsApp) of a photograph in one of the house’s layouts, with its words, and keep it on the Saved shelf (Posts › Design) where the owner can open and change it. The server draws it at once and answers the pictures. Nothing is sent: queue_post puts it in the queue for the owner’s OK. Words are checked against the house rules (get_guide) and refused with the reason.',
    input: z.object({
      photo: z.string().min(3).max(200).describe('The photo id from find_photos.'),
      format: z.enum(['both', 'story', 'square']).default('both').describe('A story and a square post (default), or one of them.'),
      template: z.enum(TEMPLATE_IDS).optional().describe(`The layout: ${AD_TEMPLATES.map(t => `${t.id} (${t.label})`).join(', ')}. Default headline; a story or a website photo with the mark burned in gets framed.`),
      headline: z.string().max(60).optional().describe('The big line, in the house voice (default: the piece’s name).'),
      kicker: z.string().max(40).optional().describe('A small line above the headline, e.g. the collection.'),
      details: z.string().max(40).optional().describe(`The call to action (default “${BRAND.voice.ctas[0].replace(/\.$/, '')}”).`),
      specs: z.string().max(120).optional().describe('The specs line (metal, karat, stones, weight). Default: exactly the ERP’s, from find_photos. Never add a figure.'),
      caption: z.string().max(2000).optional().describe('The WhatsApp caption. Default: the house’s own caption for the piece (WhatsApp formatting: *bold*, _italic_).'),
      name: z.string().max(120).optional().describe('Its name on the Saved shelf.'),
    }),
    run: async (a, ctx) => {
      const asset = await findAsset(a.photo);
      const { site, facts } = await pieceOf(asset);
      const fields = {
        kicker: a.kicker ?? '', headline: a.headline ?? asset.name, weight: a.specs ?? asset.specs,
        details: a.details ?? BRAND.voice.ctas[0].replace(/\.$/, ''),
      };
      const base = houseCaption(asset, fields.headline, site);
      refuseWords({ headline: a.headline, kicker: a.kicker, details: a.details, specs: a.specs }, facts, asset);
      refuseWords({ caption: a.caption }, `${facts} ${base}`, asset);
      const caption = a.caption ?? base;
      const marked = asset.source === 'site' && !asset.original;
      const assetId = asset.original?.id ?? asset.id;
      const want: AdFormat[] = a.format === 'both' ? [FORMATS.story, FORMATS.square] : [FORMATS[a.format]];
      const assets = await assetsOf({ assetId, doc: null });
      const pages: DesignPage[] = [];
      const files: Record<string, Buffer> = {};
      const images: ToolImage[] = [];
      for (const format of want) {
        const template = safeTemplate(a.template ?? 'headline', { marked, format });
        const doc = layOut({ format, template, fields, marked }, assets);
        doc.meta = { ...(doc.meta ?? {}), template };
        const id = format === 'story' ? 'story' : 'post';
        const frame = AD_FORMATS[format as Exclude<AdFormat, 'custom'>].frame;
        const picture = drawJpeg(doc, { fields }, assets, frame.w);
        pages.push({ id, label: format === 'story' ? AD_FORMATS.story.label : 'WhatsApp 1:1', format, frame, origin: pages.length ? 'manual' : 'master', rev: 1 });
        files[fileKey('doc', id)] = Buffer.from(JSON.stringify(doc));
        files[fileKey('image', id)] = picture;
        images.push(jpeg(await smaller(picture)));
      }
      files[fileKey('photo', 'photo')] = (await assetImage(assetId, 2048)).data;
      const thumb = `data:image/jpeg;base64,${(await sharp(files[fileKey('image', pages[0].id)]).resize(200, 200, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()).toString('base64')}`;
      const input: DesignInput = {
        name: (a.name ?? fields.headline).slice(0, 120), folder: null,
        kind: pages.length > 1 ? 'piece' : pages[0].id === 'story' ? 'story' : 'post', scope: 'shop',
        source: { assetId: asset.id, ...(site ? { siteId: site.id } : {}) },
        fields, copy: { wa: caption }, pages, master: pages[0].id, thumb,
      };
      const rec = await saveDesign(input, files, `${ctx.key.label} (AI)`);
      return {
        data: { post: rec.id, name: rec.name, pages: pages.map(p => ({ id: p.id, label: p.label })), caption, next: 'Look at the pictures; make_post again to change the words or layout; queue_post to put it in the queue for the owner’s OK.' },
        images,
      };
    },
  }),
  tool({
    name: 'view_post', title: 'Look at a post', effect: 'read', scopes: [...DRAFT],
    description: 'See a post on the Saved shelf as it was drawn (each of its pages, or one).',
    input: z.object({ post: z.string().min(1).max(40).describe('The post id (make_post, list_posts).'), page: z.string().max(40).optional().describe('One page id ("story", "post").') }),
    run: async a => {
      const rec = await designOf(a.post);
      const pages = rec.pages.filter(p => !a.page || p.id === a.page);
      if (!pages.length) throw new ToolError(`“${rec.name}” has no page “${a.page}”; it has ${rec.pages.map(p => p.id).join(', ')}.`, 404);
      const images = await Promise.all(pages.map(async p => jpeg(await smaller(await pageImage(rec, p)))));
      return { data: { post: rec.id, name: rec.name, pages: pages.map(p => ({ id: p.id, label: p.label, size: p.frame })), caption: rec.copy?.wa ?? '' }, images };
    },
  }),
  tool({
    name: 'list_posts', title: 'Posts on the Saved shelf', effect: 'read', scopes: [...DRAFT],
    description: 'The designs on the Saved shelf (Posts › Design), newest first: the ones you made and the shop’s own.',
    input: z.object({ limit: z.number().int().min(1).max(50).optional().describe('At most this many (default 15).') }),
    run: async a => {
      const all = await listDesigns({ ads: false });
      return { data: all.slice(0, a.limit ?? 15).map(d => ({ post: d.id, name: d.name, kind: d.kind, by: d.by, updated: d.updated, pages: d.pages.map(p => p.id), sent: d.published.slice(0, 3) })) };
    },
  }),
  tool({
    name: 'queue_post', title: 'Queue a post', effect: 'post', scopes: [...DRAFT],
    description: 'Put a post in the queue for its destinations: its square to WhatsApp groups or the channel (keys from list_destinations), its story to Instagram. It waits in Posts for the owner’s one-tap OK; nothing goes out until then (a key with “Send posts” may send_post it).',
    input: z.object({
      post: z.string().min(1).max(40).describe('The post id from make_post.'),
      whatsapp: z.array(z.string().max(80)).max(12).default([]).describe('WhatsApp destination keys (list_destinations).'),
      instagram_story: z.boolean().default(false).describe('Also post its story to Instagram.'),
      caption: z.string().max(2000).optional().describe('The WhatsApp caption, if not the post’s own.'),
    }),
    run: async (a, ctx) => {
      const rec = await designOf(a.post);
      const known = new Map(destinations().whatsapp.map(d => [d.key, d.label]));
      const unknown = a.whatsapp.filter(k => !known.has(k));
      if (unknown.length) throw new ToolError(`Not a WhatsApp destination here: ${unknown.join(', ')}. list_destinations gives the keys.`);
      if (!a.whatsapp.length && !a.instagram_story) throw new ToolError('Say where it goes: whatsapp keys and/or instagram_story.');
      const square = a.whatsapp.length ? pageFor(rec.pages, rec.master, 'whatsapp') : null;
      if (square && !('page' in square)) throw new ToolError('WhatsApp only takes a square: make_post with format "square" or "both".', 409);
      const story = a.instagram_story ? rec.pages.find(p => matchesRatio(p, '9:16')) : null;
      if (a.instagram_story && !story) throw new ToolError('Instagram takes the story: make_post with format "story" or "both".', 409);
      if (a.instagram_story) { const ig = await instagramReady(); if (!ig.ok) throw new ToolError(ig.why!, 409); }
      if (a.caption) refuseWords({ caption: a.caption }, `${rec.fields.weight} ${rec.copy?.wa ?? ''}`, { name: rec.name });
      const waImage = square && 'page' in square ? await pageImage(rec, square.page) : null;
      const storyImage = story ? await pageImage(rec, story) : null;
      const thumb = await smaller((waImage ?? storyImage)!, 480);
      const item = await createItem({
        by: `ai:${ctx.key.label}`, headline: rec.name, caption: a.caption ?? rec.copy?.wa ?? '', fileBase: slug(rec.name),
        counts: { site: 0, wa: waImage ? 1 : 0, story: !!storyImage }, website: null, instagram: !!storyImage, whatsapp: [...new Set(a.whatsapp)],
        thumb, sitePiece: rec.source?.siteId, proposedBy: ctx.key.label, design: rec.id,
      });
      try {
        if (waImage) await putMedia(item.id, 'wa-0', waImage);
        if (storyImage) await putMedia(item.id, 'story', storyImage);
        await changeItem(item.id, { action: 'ready' });
      } catch (e) {
        await deleteItem(item.id).catch(() => undefined);
        throw e;
      }
      const where = [...a.whatsapp.map(k => known.get(k)!), ...(storyImage ? ['Instagram story'] : [])];
      return { data: { queued: item.id, to: where, status: 'waiting for the owner’s OK in Posts', next: ctx.key.scopes.includes('posts:publish') ? 'send_post or schedule_post sends it.' : 'The owner approves it in Posts; list_queue shows when it has gone.' } };
    },
  }),
  tool({
    name: 'list_queue', title: 'The post queue', effect: 'read', scopes: [...DRAFT, ...PUBLISH],
    description: 'What is in the post queue: waiting (and whether it needs the owner’s OK), scheduled, sending, failed, and what went in the last two days.',
    input: z.object({}),
    run: async () => ({ data: (await listItems()).map(toView).map(queueRow) }),
  }),
  tool({
    name: 'withdraw_post', title: 'Take a post out of the queue', effect: 'post', scopes: [...DRAFT],
    description: 'Take a post this key queued back out, while it is still waiting for the owner.',
    input: z.object({ queue_id: z.string().min(10).max(40).describe('The queued post’s id (queue_post, list_queue).') }),
    run: async (a, ctx) => {
      const item = await queued(a.queue_id);
      if (item.proposedBy !== ctx.key.label || !awaitingApproval(item)) throw new ToolError('Only a post this key queued, still waiting for the owner, can be taken out here.', 403);
      await deleteItem(item.id);
      return { text: 'Taken out of the queue.' };
    },
  }),
  tool({
    name: 'send_post', title: 'Send a queued post now', effect: 'post', scopes: [...PUBLISH],
    description: 'Send a queued post to its destinations now (only what hasn’t gone yet, so a retry never posts twice). This is the owner’s OK given by this key.',
    input: z.object({ queue_id: z.string().min(10).max(40).describe('The queued post’s id (list_queue).') }),
    run: async (a, ctx) => {
      await queued(a.queue_id);
      const item = await claimItem(a.queue_id, new Date(), true, `ai:${ctx.key.label}`);
      if (!item) {
        const now = await getItem(a.queue_id);
        throw new ToolError(now?.status === 'sent' ? 'That post has already gone out.' : 'That post is being sent right now.', 409);
      }
      const after = await sendItem(item, { by: `ai:${ctx.key.label}`, origin: ctx.mediaOrigin });
      return { data: queueRow(toView(after)) };
    },
  }),
  tool({
    name: 'schedule_post', title: 'Schedule a queued post', effect: 'post', scopes: [...PUBLISH],
    description: 'Give a queued post a time; the queue sends it then (every five minutes it checks). This is the owner’s OK given by this key.',
    input: z.object({
      queue_id: z.string().min(10).max(40).describe('The queued post’s id (list_queue).'),
      at: z.string().max(40).describe('When, as an ISO time with its zone, e.g. 2026-10-22T15:00:00+05:00 (Karachi).'),
    }),
    run: async (a, ctx) => {
      await queued(a.queue_id);
      if (!Number.isFinite(Date.parse(a.at))) throw new ToolError('That time could not be read; send an ISO time like 2026-10-22T15:00:00+05:00.');
      const item = await changeItem(a.queue_id, { action: 'schedule', dueAt: a.at, by: `ai:${ctx.key.label}` });
      return { data: queueRow(toView(item)) };
    },
  }),
];

