/**
 * Messages to the house's WhatsApp line, from WAHA (the session's webhook, event "message"): the customer's
 * answer to a web order's message (lib/shopify-whatsapp-server.ts `handleInbound`). Nothing else is acted on.
 *
 * Signed by WAHA: X-Webhook-Hmac is the SHA-512 HMAC of the raw body under `inboundHmacKey()`, which is
 * derived from WAHA_API_KEY (both ends hold it already, so there is no new secret to keep). An unsigned or
 * wrongly signed call is refused. The webhook is set on the session by scripts/waha-inbound-webhook.ts.
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { getShopifyCredentials } from '@/app/api/shopify/_lib';
import { handleInbound, shopifyOrderWhatsAppOn } from '@/lib/shopify-whatsapp-server';
import { senderNumber } from '@/lib/shopify-whatsapp';
import { inboundHmacKey } from '@/lib/whatsapp-inbound-key';

export const dynamic = 'force-dynamic';

function signed(raw: string, header: string | null): boolean {
  const key = inboundHmacKey();
  if (!key || !header) return false;
  const want = crypto.createHmac('sha512', key).update(raw, 'utf8').digest();
  const got = Buffer.from(header, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!signed(raw, req.headers.get('x-webhook-hmac'))) return NextResponse.json({ error: 'not signed' }, { status: 401 });
  let body: { event?: string; session?: string; payload?: Record<string, unknown> };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true, skipped: 'not json' }); }
  if (body.event !== 'message' || !body.payload) return NextResponse.json({ ok: true, skipped: 'not a message' });
  if ((process.env.WAHA_SESSION || '').trim() && body.session !== (process.env.WAHA_SESSION || '').trim()) return NextResponse.json({ ok: true, skipped: 'another line' });
  if (!shopifyOrderWhatsAppOn()) return NextResponse.json({ ok: true, skipped: 'off' });

  const p = body.payload as { from?: string; fromMe?: boolean; body?: string; hasMedia?: boolean; media?: { mimetype?: string } | null; _data?: { Info?: { SenderAlt?: string; Sender?: string; IsGroup?: boolean } } };
  if (p.fromMe || p._data?.Info?.IsGroup || /@(g\.us|newsletter|broadcast)$/.test(String(p.from || ''))) return NextResponse.json({ ok: true, skipped: 'not a customer' });
  const mime = String(p.media?.mimetype || '');
  const media = !!p.hasMedia && (mime.startsWith('image/') || mime === 'application/pdf' || !mime);
  try {
    const outcome = await handleInbound({ phone: senderNumber(p), text: String(p.body || ''), media }, () => getShopifyCredentials(adminDb));
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    console.error('[whatsapp/inbound]', (e as Error)?.message);
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
