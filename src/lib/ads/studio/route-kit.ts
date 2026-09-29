/**
 * What the Ad studio's routes share: turning a failure into an answer (the model's
 * errors as well as Meta's), and the day's cap on model calls that aren't the
 * library's assessing (which has its own).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail } from '@/lib/ads/gate';
import { AiError, aiConfigured } from '@/lib/social/ai';
import { callerKey, rateLimit } from '@/lib/website/ratelimit';

const DAILY = Number(process.env.AD_STUDIO_AI_DAILY_CAP) || 200;

export function studioFail(e: unknown, where: string): NextResponse {
  if (e instanceof AiError) return NextResponse.json({ error: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 502 });
  const status = (e as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && e instanceof Error) return NextResponse.json({ error: e.message }, { status });
  return adsFail(e, `studio/${where}`);
}

/** Null when the call may go ahead; otherwise the answer to send. */
export async function studioAiGate(req: NextRequest): Promise<NextResponse | null> {
  if (!aiConfigured()) return NextResponse.json({ error: 'AI is not set up for this shop.' }, { status: 503 });
  const [day, hour] = await Promise.all([
    rateLimit('ad-studio-ai-day', 'shop', DAILY, 86_400),
    rateLimit('ad-studio-ai-hour', callerKey(req.headers), 60, 3_600),
  ]);
  if (!day.ok) return NextResponse.json({ error: `The studio has used today’s ${DAILY} AI calls. Try again tomorrow.` }, { status: 429 });
  if (!hour.ok) return NextResponse.json({ error: 'Too many AI calls this hour from here. Try again shortly.' }, { status: 429 });
  return null;
}
