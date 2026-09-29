/**
 * POST — a creative director's verdict on a finished ad before it spends: the house's
 * hard rules one by one, the craft (does the piece read at thumbnail size, the type, the
 * mark, the safe zones of a story), fixes in order, and whether the days it would run
 * cross a sacred date (calendar.ts — decided here, not by the model).
 *
 * multipart: image (JPEG), format, text?, headline?, start? (YYYY-MM-DD), days?
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { generateJson, prepareImage, TEXT_MODEL } from '@/lib/social/ai';
import { CHECK_SCHEMA, CHECK_SYSTEM, breaksHouseRule, checkPrompt, type CheckVerdict } from '@/lib/ads/studio/prompts';
import { adDayStatus, karachiDay, quietDaysBetween, hijriLabel } from '@/lib/ads/studio/calendar';
import { studioAiGate, studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const blocked = await studioAiGate(req);
  if (blocked) return blocked;
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get('image');
    if (!(file instanceof File) || file.size > 20 * 1024 * 1024) return NextResponse.json({ error: 'No ad image was received.' }, { status: 400 });
    const s = (k: string, max = 800) => { const v = form?.get(k); return typeof v === 'string' ? v.trim().slice(0, max) : ''; };
    const text = s('text'), headline = s('headline', 120), format = s('format', 60) || 'a feed ad';
    const start = /^\d{4}-\d{2}-\d{2}$/.test(s('start')) ? s('start') : karachiDay(new Date());
    const days = Math.min(90, Math.max(1, Number(s('days')) || 7));
    const until = karachiDay(new Date(Date.parse(`${start}T12:00:00+05:00`) + (days - 1) * 86_400_000));

    const verdict = await generateJson<CheckVerdict>({
      model: process.env.AD_STUDIO_TEXT_MODEL?.trim() || TEXT_MODEL, system: CHECK_SYSTEM, schema: CHECK_SCHEMA, temperature: 0.2,
      parts: [{ inlineData: await prepareImage(Buffer.from(await file.arrayBuffer())) }, { text: checkPrompt({ format, text, headline }) }],
    });
    const quiet = quietDaysBetween(start, until);
    const sacred = quiet.filter(d => d.level === 'sacred' || d.level === 'near');
    return NextResponse.json({
      verdict: { ...verdict, score: Math.max(0, Math.min(100, Math.round(Number(verdict.score) || 0))) },
      words: { text: !!text && breaksHouseRule(text), headline: !!headline && breaksHouseRule(headline) },
      calendar: {
        start, until, today: adDayStatus(new Date()),
        quiet: quiet.map(d => ({ date: d.date, level: d.level, hijri: hijriLabel(d.hijri), name: d.observance?.name ?? '', rule: d.observance?.rule ?? '' })),
        blocked: sacred.length > 0,
      },
    }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'check');
  }
}
