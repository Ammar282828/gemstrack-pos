/**
 * POST — the words for an ad, in the house's voice: primary texts, headlines and
 * descriptions for Meta's fields, and the kicker / headline / call to action for the
 * picture. Prices, specs and direct calls to action are allowed (the owner, 2026-09-29);
 * what is dropped here, whatever the model says, is sale or discount language, a hashtag,
 * and any figure the ERP didn't give it (a karat, weight, carat or price it made up).
 *
 * Body: { name, subject?, category?, collection?, brief?, goal, specs?, price? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { generateJson, TEXT_MODEL } from '@/lib/social/ai';
import { COPY_SCHEMA, COPY_SYSTEM, VOICE, breaksHouseRule, copyPrompt, inventedFigures, type CopyResult } from '@/lib/ads/studio/prompts';
import { studioAiGate, studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Allowed: within length, no house rule broken, and no figure beyond the facts given. */
const ok = (x: string, max: number, facts: string) => !!x && x.length <= max && !breaksHouseRule(x) && inventedFigures(x, facts).length === 0;
const clean = (xs: unknown, max: number, facts: string) => (Array.isArray(xs) ? xs : [])
  .map(x => (typeof x === 'string' ? x.trim() : '')).filter(x => ok(x, max, facts));

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const blocked = await studioAiGate(req);
  if (blocked) return blocked;
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const s = (k: string, max = 300) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '');
    const r = await generateJson<CopyResult>({
      model: process.env.AD_STUDIO_TEXT_MODEL?.trim() || TEXT_MODEL, system: COPY_SYSTEM, schema: COPY_SCHEMA, temperature: 0.8,
      parts: [{ text: copyPrompt({ name: s('name', 120) || 'a piece', subject: s('subject'), category: s('category', 60), collection: s('collection', 80), brief: s('brief', 500), goal: s('goal', 80) || 'WhatsApp conversations', specs: s('specs', 200), price: s('price', 80) }) }],
    });
    const facts = [s('specs', 200), s('price', 80)].filter(Boolean).join(' · ');
    const on = r.onImage ?? { kicker: '', headline: '', details: '' };
    const safe = (x: unknown, max: number, fallback: string) => { const t = typeof x === 'string' ? x.trim() : ''; return ok(t, max, facts) ? t : fallback; };
    const out: CopyResult = {
      primaryText: clean(r.primaryText, 600, facts),
      headlines: clean(r.headlines, 60, facts),
      descriptions: clean(r.descriptions, 45, facts),
      onImage: { kicker: safe(on.kicker, 40, ''), headline: safe(on.headline, 60, ''), details: safe(on.details, 60, VOICE.ctas[0].replace(/\.$/, '')) },
      why: typeof r.why === 'string' ? r.why.slice(0, 300) : '',
    };
    return NextResponse.json(out, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'copy');
  }
}
