/**
 * POST { input: string, ai?: boolean } → what Smart input understood (plan §4.2). Words, a link or a SKU.
 *
 *   text  parseMany (deterministic, instant, free); when it is unsure (confidence under 0.6) one bounded
 *         generateJson call reads the paragraph, and what it answers is kept only where it passes the house
 *         rules against the pasted words (acceptAiFields: no figure that isn't in the input).
 *   url   routed by host (parse-url.ts): this house's website piece, the Mina catalogue, a Shopify product,
 *         an Instagram post, a Drive folder (owners only), any page's og tags.
 *   sku   the ERP's own product (staff included: the same read the cart makes).
 *
 * The AI is optional everywhere: without it, or when Google is out of quota, the deterministic read stands.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { CHECK_MODEL, aiConfigured, generateJson } from '@/lib/social/ai';
import { designFail, designGate, mayUseAds, noStore } from '@/lib/design/gate';
import { acceptAiFields, classifyInput, parseMany, parseSnippet, toPiece, type AiFields, type ParsedPiece, type ParseResponse, type SnippetResult } from '@/lib/design/parse';
import { classifyUrl, fetchPageText, instagramCaption, matchSitePiece, parseOg, parseShopifyProduct, pieceFields, type UrlRoute } from '@/lib/design/parse-url';
import { bounded } from '@/lib/design/image-in';
import { pieceSpecs } from '@/lib/ads/studio/specs';
import { headlineOf } from '@/lib/website/site-photo';
import { getSitePieces, siteOrigin } from '@/lib/website/site-pieces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_INPUT = 6000;

const AI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' }, kicker: { type: 'STRING' }, details: { type: 'STRING' },
    karat: { type: 'STRING' }, metal: { type: 'STRING' }, stone: { type: 'STRING' },
    weightG: { type: 'NUMBER' }, priceAmount: { type: 'NUMBER' },
    suggestedKind: { type: 'STRING', enum: ['piece', 'ad', 'story', 'post', 'whatsapp', 'site', 'custom'] },
  },
};
const AI_SYSTEM = `You read a jeweller's message (English, Urdu or Roman-Urdu, maybe a forwarded WhatsApp message) about one piece of jewellery and fill a form.
Use ONLY what the message says. Never calculate, convert, round or invent a figure: weightG is the weight in grams only if the message states grams, priceAmount only if it states a price. A weight in tola, masha or ratti stays unset.
headline: the piece's name in a few words, as the message calls it. kicker: its collection if named. details: a short call to action if the message has one, else empty. suggestedKind: story, post, whatsapp, ad, site or piece only if the message asks for one. Leave anything unknown empty. No sale or discount words, no hashtags.`;

async function aiRead(r: SnippetResult, input: string): Promise<SnippetResult> {
  const ai = await bounded(generateJson<AiFields>({ model: CHECK_MODEL, system: AI_SYSTEM, parts: [{ text: input.slice(0, MAX_INPUT) }], schema: AI_SCHEMA, temperature: 0 }), 25_000, 'parse');
  return ai ? acceptAiFields(r, ai, input) : r;
}

async function fromText(input: string, wantAi: boolean): Promise<ParseResponse> {
  const reads = parseMany(input);
  let usedAi = false;
  const pieces: ParsedPiece[] = [];
  for (const r0 of reads) {
    let r = r0;
    if (wantAi && aiConfigured() && (r.confidence < 0.6 || !r.fields.headline) && reads.length === 1) {
      const better = await aiRead(r, input);
      usedAi = better !== r;
      r = better;
    }
    pieces.push(toPiece(r));
  }
  return { kind: 'text', pieces, usedAi, warnings: [] };
}

const noPiece = (route: UrlRoute, why: string): ParseResponse => ({ kind: 'url', pieces: [], usedAi: false, warnings: [why, ...(route.url ? [] : [])] });

async function fromUrl(route: UrlRoute, who: string): Promise<ParseResponse> {
  if (!route.url) return noPiece(route, 'That isn’t a web address the ERP can read. Paste a link that starts with https://.');
  const u = route.url;
  if (route.kind === 'drive') {
    if (!mayUseAds(who)) return noPiece(route, 'A Drive folder link can only be added by the owner or marketing.');
    return { kind: 'url', pieces: [], usedAi: false, drive: { folderId: route.folderId! }, warnings: [] };
  }
  if (route.kind === 'house-site' || route.kind === 'mina-catalogue') {
    const { pieces } = await getSitePieces().catch(() => ({ pieces: [] as Awaited<ReturnType<typeof getSitePieces>>['pieces'] }));
    const p = matchSitePiece(pieces, u.toString());
    if (p) {
      const fields = pieceFields(p);
      const piece = { siteId: p.id, name: p.name, collection: p.collection || undefined, url: p.url || undefined };
      return {
        kind: 'url', usedAi: false, warnings: [],
        pieces: [{
          name: headlineOf(p.name) || p.name, fields, specs: { karat: p.words.karat, metal: p.words.metal, stone: p.words.stone, ...(p.weightGrams ? { weightG: p.weightGrams } : {}) },
          piece, photos: [{ ref: `site:${p.id}`, role: 'main' }], confidence: 0.95, warnings: [],
        }],
      };
    }
  }
  if (route.kind === 'shopify-product') {
    const res = await fetch(new URL(`/products/${route.handle}.json`, u), { signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } }).catch(() => null);
    const shop = res?.ok ? parseShopifyProduct(await res.json().catch(() => null)) : null;
    if (shop) {
      const snippet = parseSnippet(`${shop.title}\n${shop.description}`);
      const fields = { ...snippet.fields, headline: headlineOf(shop.title) || snippet.fields.headline };
      if (!fields.headline) delete fields.headline;
      return {
        kind: 'url', usedAi: false, warnings: [],
        pieces: [{
          ...toPiece({ ...snippet, name: shop.title, fields }, shop.images.slice(0, 6).map((src, i) => ({ ref: `url:${src}`, role: i === 0 ? 'main' as const : 'alt' as const })), { name: shop.title, url: u.toString() }),
          ...(shop.price ? { price: { amount: shop.price, currency: 'PKR' as const, text: `PKR ${shop.price.toLocaleString('en-PK')}` } } : {}),
        }],
      };
    }
  }
  // Instagram, any other page, and a site/catalogue/Shopify address that did not resolve: what the page says about itself.
  const { html } = await fetchPageText(u);
  const og = parseOg(html, u);
  const text = route.kind === 'instagram' ? instagramCaption(og.description) : [og.title, og.description].filter(Boolean).join('\n');
  const r = parseSnippet(text);
  const piece = { name: og.title || r.name, url: u.toString() };
  const photos = og.image ? [{ ref: `url:${og.image}`, role: 'main' as const }] : [];
  if (!photos.length) r.warnings.push('The page shares no picture. Save the photo and drop it in.');
  return { kind: 'url', usedAi: false, warnings: [], pieces: [toPiece(r.name ? r : { ...r, name: headlineOf(og.title) }, photos, piece)] };
}

async function fromSku(sku: string): Promise<ParseResponse> {
  const snap = await adminDb.collection('products').doc(sku.trim()).get();
  const p = snap.exists ? snap.data() as { name?: string; karat?: string; metalType?: string; metalWeightG?: number; stoneDetails?: string; imageUrl?: string } : null;
  if (!p?.name) return { kind: 'sku', pieces: [], usedAi: false, warnings: [`No piece with the code ${sku.trim()} in the ERP.`] };
  const karat = p.karat ? p.karat.toUpperCase() : undefined;
  const metal = p.metalType ? p.metalType.replace(/^./, c => c.toUpperCase()) : undefined;
  const weight = typeof p.metalWeightG === 'number' && p.metalWeightG > 0 ? p.metalWeightG : null;
  const fields: ParsedPiece['fields'] = {};
  const h = headlineOf(p.name);
  if (h) fields.headline = h;
  const line = pieceSpecs({ karat, metal, stone: p.stoneDetails, weightGrams: weight });
  if (line) fields.weight = line;
  return {
    kind: 'sku', usedAi: false, warnings: [],
    pieces: [{
      name: h || p.name, fields, specs: { karat, metal, stone: p.stoneDetails || undefined, ...(weight ? { weightG: weight } : {}) },
      piece: { productId: sku.trim(), name: p.name }, photos: p.imageUrl ? [{ ref: `url:${p.imageUrl}`, role: 'main' }] : [], confidence: 0.95, warnings: [],
    }],
  };
}

export async function POST(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  try {
    const body = await req.json().catch(() => null) as { input?: unknown; ai?: unknown } | null;
    const input = typeof body?.input === 'string' ? body.input.trim() : '';
    if (!input) return NextResponse.json({ error: 'Paste something to read.' }, { status: 400, headers: noStore });
    if (input.length > MAX_INPUT) return NextResponse.json({ error: 'That is too long to read at once. Paste one message at a time.' }, { status: 413, headers: noStore });
    const c = classifyInput(input);
    let out: ParseResponse;
    if (c.kind === 'url') out = await fromUrl(classifyUrl(c.urls[0], siteOrigin()), who);
    else if (c.kind === 'sku') {
      out = await fromSku(input);
      // A short code that is no product may just be a word with a number in it: read it as words.
      if (!out.pieces.length) out = { ...(await fromText(input, false)), warnings: out.warnings };
    } else {
      out = await fromText(input, body?.ai !== false);
      // Words with a link in them (an Instagram caption pasted with its address): the link's photo comes along.
      const link = c.urls[0] ? classifyUrl(c.urls[0], siteOrigin()) : null;
      if (link?.url && out.pieces.length === 1 && link.kind !== 'drive') {
        const viaLink = await fromUrl(link, who).catch(() => null);
        const photos = viaLink?.pieces[0]?.photos ?? [];
        if (photos.length) out.pieces[0] = { ...out.pieces[0], photos, ...(viaLink?.pieces[0]?.piece ? { piece: viaLink.pieces[0].piece } : {}) };
      }
    }
    return NextResponse.json(out, { headers: noStore });
  } catch (e) {
    return designFail(e, 'parse');
  }
}
