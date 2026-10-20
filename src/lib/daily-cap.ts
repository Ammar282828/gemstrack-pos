/**
 * A per-account daily cap on the routes that cost money or reach the public (AI, Instagram, WhatsApp).
 * Generous on purpose: shop use never meets it; a stolen session or a runaway script does. One counter per
 * scope and account (Firestore `website_ratelimit`, a 24 h window from the first call). Fails open if the
 * counter itself cannot be read: the shop is never locked out by its own safety net.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';
import { verifyRequestEmail } from '@/lib/karigar-auth';

export const AI_PER_DAY = 300;
export const WHATSAPP_PER_DAY = 100;
export const INSTAGRAM_PER_DAY = 100;

const LABEL: Record<string, string> = { ai: 'AI requests', whatsapp: 'WhatsApp sends', instagram: 'Instagram posts' };

/** `who` is the signed-in email (a gate's answer); null/'counter' falls back to the caller's address. */
export async function dailyCap(scope: 'ai' | 'whatsapp' | 'instagram', who: string | null, req: NextRequest, max: number): Promise<NextResponse | null> {
  const key = who && who !== 'counter' ? who.toLowerCase() : `ip-${callerKey(req.headers)}`;
  try {
    const r = await rateLimit(`cap-${scope}`, key, max, 24 * 3600);
    if (r.ok) return null;
    const hours = Math.max(1, Math.ceil(r.retryAfter / 3600));
    return NextResponse.json(
      { error: `Today's limit of ${max} ${LABEL[scope]} for this account is used up. It opens again in about ${hours} hour${hours === 1 ? '' : 's'}.` },
      { status: 429, headers: { 'Retry-After': String(r.retryAfter) } },
    );
  } catch (e) {
    console.warn('[daily-cap] counter unavailable, letting the request through', e);
    return null;
  }
}

/** For routes whose gate does not hand back the email (vision, voice): look it up from the token. */
export async function dailyCapForRequest(scope: 'ai' | 'whatsapp' | 'instagram', req: NextRequest, max: number): Promise<NextResponse | null> {
  return dailyCap(scope, await verifyRequestEmail(req), req, max);
}
