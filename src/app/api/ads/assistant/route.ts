/**
 * POST { messages: [{ role: 'user' | 'assistant', text }], range, page }
 *   → { reply, model, tools }
 *
 * The Ads helper (src/lib/ads/assistant.ts): Gemini Pro with this house's ad
 * account in front of it. Capped like Post a Piece's AI — ADS_AI_DAILY_CAP a
 * day for the shop (default 200) and 40 an hour per caller — because every
 * question is a Pro call billed to Murtaza's project.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate } from '@/lib/ads/gate';
import { askAds, type ChatMessage } from '@/lib/ads/assistant';
import { isRange, type RangeKey } from '@/lib/ads/shape';
import { AiError } from '@/lib/social/ai';
import { callerKey, rateLimit } from '@/lib/website/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DAILY_CAP = Number(process.env.ADS_AI_DAILY_CAP) || 200;

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => ({}))) as { messages?: ChatMessage[]; range?: string; page?: string };
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map(m => ({ role: m.role, text: m.text.trim() }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return NextResponse.json({ error: 'Ask something first.' }, { status: 400 });
  const range: RangeKey = isRange(body.range) ? body.range : 'last_7d';
  const page = typeof body.page === 'string' ? body.page.slice(0, 40) : 'Ads';

  const [day, hour] = await Promise.all([
    rateLimit('ads-ai-day', 'shop', DAILY_CAP, 86_400),
    rateLimit('ads-ai-hour', callerKey(req.headers), 40, 3_600),
  ]);
  if (!day.ok || !hour.ok) {
    const wait = Math.ceil(Math.max(day.ok ? 0 : day.retryAfter, hour.ok ? 0 : hour.retryAfter) / 60);
    return NextResponse.json({ error: `That’s the helper’s limit for now — try again in about ${wait} minute${wait === 1 ? '' : 's'}.` }, { status: 429 });
  }

  try {
    return NextResponse.json(await askAds({ messages, range, page }));
  } catch (e) {
    if (e instanceof AiError) return NextResponse.json({ error: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
    return adsFail(e, 'assistant');
  }
}
