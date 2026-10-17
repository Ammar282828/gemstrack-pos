import { NextResponse } from 'next/server';
import { whatsAppStatus } from '@/lib/whatsapp';

/**
 * Is WhatsApp actually able to send right now?
 *
 * The WhatsApp gateway (WAHA, or Green API) silently drops out when the linked
 * phone is offline too long or the QR is revoked, and the only symptom is
 * messages not arriving. Safe to leave unauthenticated: it reports a state
 * string and never the credentials.
 */
export async function GET() {
  const status = await whatsAppStatus();
  // `error` says it in words for a caller that reads only that on a 503 (the iPhone app's ERPAPI).
  const error = status.ok ? undefined : !status.configured ? 'Not configured' : ['Not ready', status.state, status.detail].filter(Boolean).join(' — ');
  return NextResponse.json({ ...status, ...(error && { error }) }, { status: status.ok ? 200 : 503 });
}
