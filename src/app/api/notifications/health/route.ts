import { NextResponse } from 'next/server';
import { whatsAppStatus } from '@/lib/whatsapp';

/**
 * Is WhatsApp actually able to send right now?
 *
 * A Green API instance silently drops out of "authorized" when the linked
 * phone is offline too long or the QR is revoked, and the only symptom is
 * messages not arriving. Safe to leave unauthenticated: it reports a state
 * string and never the credentials.
 */
export async function GET() {
  const status = await whatsAppStatus();
  return NextResponse.json(status, { status: status.ok ? 200 : 503 });
}
