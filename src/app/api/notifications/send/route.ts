import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage, WhatsAppNotConfiguredError } from '@/lib/whatsapp';
import { isCronAuthorized } from '@/lib/api-auth';
import { verifyRequestEmail, isOwnerEmail } from '@/lib/karigar-auth';
import { adminDb } from '@/lib/firebase-admin';
import { fromThisPos } from '@/lib/notify-label';

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

/** Last nine digits — the shop's numbers are written 0335…, 92335…, +92 335… */
const tail = (phone: unknown) => String(phone ?? '').replace(/\D/g, '').slice(-9);

/**
 * While the app is open, sending is allowed only to the shop's own alert list.
 *
 * The other routes simply follow NEXT_PUBLIC_OPEN_ACCESS, because the worst an open
 * one does is spend Vertex credits. This one is different in kind: it sends WhatsApp
 * from the shop's linked account, so opening it outright would hand the internet a
 * relay that messages anybody as Taheri — and Green API is an unofficial gateway, so
 * the number gets banned rather than rate-limited.
 *
 * Restricting it to numbers already saved in Settings keeps the test buttons working
 * while the sign-in is off, and caps the damage of an unauthenticated call at sending
 * the shop's own staff a message they can ignore.
 */
async function allowedWhileOpen(to: string): Promise<boolean> {
  const want = tail(to);
  if (!want) return false;
  try {
    const snap = await adminDb.collection('app_settings').limit(1).get();
    const phones = (snap.empty ? [] : snap.docs[0].data()?.notifPhones) as unknown;
    return Array.isArray(phones) && phones.some((p) => tail(p) === want);
  } catch (e) {
    // A settings read that fails must not become an open relay.
    console.error('[/api/notifications/send] could not read the recipient list', e);
    return false;
  }
}

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

  let to: string, message: string;
  try {
    ({ to, message } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }
  if (!to || !message) {
    return NextResponse.json({ error: 'Missing to or message' }, { status: 400 });
  }

  // Sign-in is off, so there is no token to check and this used to refuse every call —
  // which is what the Test buttons in Settings were reporting.
  const viaOpenList = !viaCron && !viaOwner && OPEN_ACCESS && await allowedWhileOpen(to);
  if (!viaCron && !viaOwner && !viaOpenList) {
    return NextResponse.json({
      error: OPEN_ACCESS
        ? 'While sign-in is off, messages can only go to the numbers saved in Settings.'
        : 'Unauthorized',
    }, { status: OPEN_ACCESS ? 403 : 401 });
  }

  try {
    // Named after this POS, since the owner gets both houses' alerts (lib/notify-label.ts).
    await sendWhatsAppMessage(to, fromThisPos(message));
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const notConfigured = err instanceof WhatsAppNotConfiguredError;
    const detail = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/notifications/send]', detail);
    return NextResponse.json({ error: detail }, { status: notConfigured ? 503 : 500 });
  }
}
