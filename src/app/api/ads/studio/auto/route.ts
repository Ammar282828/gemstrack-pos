/**
 * POST — Make it with AI (the owner, 2026-09-29: "it should just make an ad creative using
 * ai and the photo/details").
 *
 *   op=direct  the art director: layout, every word, and what the photo needs (extend to the
 *              shape, a new setting) — the maker then lays it out itself, so the words and
 *              figures on the ad are exact.
 *   op=paint   the whole ad painted by the image model from the photo and the words, then
 *              read back (every line must be there, spelled right) and compared with the
 *              photo ("same piece?"). Advice on the page, not a block — the owner decides.
 *
 * multipart: image, op, params JSON { name, collection, specs, price, format, aspect,
 * brief, destination, kicker, headline, cta }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { CHECK_MODEL, generateImage, generateJson, generateText, prepareImage, type InlineImage } from '@/lib/social/ai';
import { CHECK_PROMPT, CHECK_SCHEMA, CHECK_SYSTEM, READ_PROMPT, type CheckResult } from '@/lib/social/prompts';
import { breaksHouseRule, inventedFigures, paintPrompt } from '@/lib/ads/studio/prompts';
import { artDirect } from '@/lib/ads/studio/art-direct';
import { studioAiGate, studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ASPECT: Record<string, string> = { portrait: '4:5', square: '1:1', story: '9:16', landscape: '16:9' };
/** Every ratio the image model draws at; the maker sends the one its shape needs (any shape, 2026-10-01). */
const RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9.'·|]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const blocked = await studioAiGate(req);
  if (blocked) return blocked;
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get('image');
    if (!(file instanceof File) || file.size > 25 * 1024 * 1024) return NextResponse.json({ error: 'No photo was received.' }, { status: 400 });
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(String(form?.get('params') || '{}')); } catch { /* empty */ }
    const s = (k: string, max = 200) => (typeof params[k] === 'string' ? (params[k] as string).trim().slice(0, max) : '');
    const photo = await prepareImage(Buffer.from(await file.arrayBuffer()));
    const facts = [s('specs'), s('price', 80)].filter(Boolean).join(' · ');
    const format = s('format', 20) || 'portrait';
    const asked = s('aspect', 8);
    const aspect = RATIOS.includes(asked) ? asked : (ASPECT[format] ?? '4:5');
    const shape = s('shape', 40) || format;

    if (form?.get('op') === 'paint') {
      const words = { kicker: s('kicker', 40), headline: s('headline', 60), specs: s('specs'), cta: s('cta', 60) };
      if (!words.headline) return NextResponse.json({ error: 'A headline is needed to paint the ad.' }, { status: 400 });
      const bad = [words.kicker, words.headline, words.cta].find(t => t && (breaksHouseRule(t) || inventedFigures(t, facts).length));
      if (bad) return NextResponse.json({ error: `“${bad}” has a figure the ERP didn't give, or sale/discount words — change it first.` }, { status: 400 });
      const image = await generateImage({ images: [photo], aspect, size: '2K', prompt: paintPrompt({ ...words, aspect, story: aspect === '9:16', brief: s('brief', 400), trimTo: /^\d+(\.\d+)?:\d+$/.test(s('trimTo', 12)) ? s('trimTo', 12) : undefined }) });
      const painted: InlineImage = { mimeType: image.mimeType, data: image.data };
      const [read, check] = await Promise.all([
        generateText({ parts: [{ inlineData: painted }, { text: READ_PROMPT }] }).catch(() => ''),
        generateJson<CheckResult>({ model: CHECK_MODEL, system: CHECK_SYSTEM, parts: [{ inlineData: photo }, { inlineData: painted }, { text: CHECK_PROMPT }], schema: CHECK_SCHEMA, temperature: 0 }).catch(() => null),
      ]);
      const got = norm(read);
      const missing = [words.kicker, words.headline, words.specs, words.cta].filter(Boolean).filter(l => !got.includes(norm(l)));
      return NextResponse.json({ image, lettering: { read, missing, ok: !!read && missing.length === 0 }, check }, { headers: noStore });
    }

    const direction = await artDirect(photo, {
      name: s('name', 120), collection: s('collection', 80), specs: s('specs'), price: s('price', 80), brief: s('brief', 400),
      format: `${shape} (${aspect})`, destination: s('destination', 120),
    });
    return NextResponse.json({ direction }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'auto');
  }
}
