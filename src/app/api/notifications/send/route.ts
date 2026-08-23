import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage, WhatsAppNotConfiguredError } from '@/lib/whatsapp';
import { isCronAuthorized } from '@/lib/api-auth';
import { verifyRequestEmail, isOwnerEmail } from '@/lib/karigar-auth';

/**
 * Send one WhatsApp message.
 *
 * Gated on CRON_SECRET in strict mode. This endpoint was previously open: a
 * POST of {to, message} from anywhere on the internet would send a WhatsApp
 * from the shop's linked account to any number, which is both a spam relay
 * and a way to burn the Green API quota.
 */
export async function POST(req: NextRequest) {
  // Two legitimate callers: the scheduler, which carries CRON_SECRET, and the
  // app itself, where a signed-in owner triggers a real-time alert. The owner
  // path verifies a Firebase ID token — the browser cannot hold the secret.
  const viaCron = isCronAuthorized(req, { strict: true });
  const viaOwner = viaCron ? false : isOwnerEmail(await verifyRequestEmail(req));
  if (!viaCron && !viaOwner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { to, message } = await req.json();
    if (!to || !message) {
      return NextResponse.json({ error: 'Missing to or message' }, { status: 400 });
    }

    await sendWhatsAppMessage(to, message);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const notConfigured = err instanceof WhatsAppNotConfiguredError;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/notifications/send]', message);
    return NextResponse.json({ error: message }, { status: notConfigured ? 503 : 500 });
  }
}
