import crypto from 'crypto';

/**
 * The key WAHA signs incoming-message webhooks with (app/api/whatsapp/inbound), derived from WAHA_API_KEY so
 * the ERP and the script that sets the webhook (scripts/waha-inbound-webhook.ts) agree without a new secret.
 * '' when WAHA is not configured. Server-only.
 */
export function inboundHmacKey(apiKey = process.env.WAHA_API_KEY || ''): string {
  const k = apiKey.trim();
  return k ? crypto.createHash('sha256').update(`whatsapp-inbound:${k}`).digest('hex') : '';
}
