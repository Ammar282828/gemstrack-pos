/**
 * POST one picture (multipart `file`, or JSON `{ url }`) → what is in it (plan §4.2 "Image drop"): the subject's
 * box (feeds the resize), lettering burned into the photograph, its category and background, a suggested
 * headline. One image per request, read once, at most 25 MB, resized with sharp to 1600 px before the model
 * (the 2026-10-01 out-of-memory lesson). One bounded vision call; without it (no AI, out of quota, too slow)
 * the answer is `analysis: null` with the picture's size and a name from the file, never an error.
 *
 * With `?asset=<library id>` (owner and marketing) the subject box is written to that library photo as
 * `focus` in ad_assets, where the resize reads it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { aiConfigured, generateJson, TEXT_MODEL } from '@/lib/social/ai';
import { designFail, designGate, mayUseAds, noStore } from '@/lib/design/gate';
import { bounded, imageFromRequest } from '@/lib/design/image-in';
import { ANALYZE_SCHEMA, ANALYZE_SYSTEM, normalizeAnalysis, type Analysis } from '@/lib/design/layers';
import { ASSETS, docIdOf } from '@/lib/ads/studio/assets';
import { headlineOf } from '@/lib/website/site-photo';
import { dailyCap, dailyCapForRequest, AI_PER_DAY, WHATSAPP_PER_DAY, INSTAGRAM_PER_DAY } from '@/lib/daily-cap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  const capped = await dailyCap('ai', who, req, AI_PER_DAY);
  if (capped) return capped;
  try {
    const img = await imageFromRequest(req);
    const base = { width: img.width, height: img.height, name: headlineOf(img.name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_]+/g, ' ')) };
    let analysis: Analysis | null = null;
    if (aiConfigured()) {
      const raw = await bounded(generateJson<unknown>({
        model: TEXT_MODEL, system: ANALYZE_SYSTEM, schema: ANALYZE_SCHEMA, temperature: 0,
        parts: [{ inlineData: img.inline }, { text: 'Read this picture.' }],
      }), 45_000, 'analyze');
      analysis = normalizeAnalysis(raw);
    }
    const asset = req.nextUrl.searchParams.get('asset');
    if (asset && analysis?.subject && mayUseAds(who)) {
      await adminDb.collection(ASSETS).doc(docIdOf(asset)).set({ focus: analysis.subject }, { merge: true }).catch(() => {});
    }
    return NextResponse.json({ ...base, analysis, ai: !!analysis }, { headers: noStore });
  } catch (e) {
    return designFail(e, 'analyze');
  }
}
