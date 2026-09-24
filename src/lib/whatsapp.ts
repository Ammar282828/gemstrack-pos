/**
 * Outbound WhatsApp, via Green API.
 *
 * One transport, deliberately. This used to try a local whatsapp-web.js
 * bridge, then Green API, then CallMeBot, then the Meta Cloud API, falling
 * through silently — so when a message did not arrive there was no way to
 * tell which of the four had been attempted, and an unconfigured deployment
 * logged a warning and carried on as if it had sent.
 *
 * Green API is an unofficial gateway: one linked account (QR scan) can then
 * message anyone, with no per-recipient setup and no 24-hour window. That is
 * the right trade for internal alerts to your own number. It is the wrong
 * trade for customer-facing messages — those need the official Meta Cloud
 * API with approved templates, or the number risks being banned.
 *
 * Configure:
 *   GREENAPI_ID_INSTANCE   instance id, e.g. "7103xxxxxx"
 *   GREENAPI_API_TOKEN     API token for that instance
 *   GREENAPI_BASE_URL      optional, defaults to https://api.green-api.com
 */

const DEFAULT_BASE = 'https://api.green-api.com';

/** Strip everything but digits so "+92 300…" and "92300…" are one number. */
function digitsOnly(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

function credentials(): { base: string; id: string; token: string } | null {
  const id = process.env.GREENAPI_ID_INSTANCE;
  const token = process.env.GREENAPI_API_TOKEN;
  if (!id || !token) return null;
  return { base: (process.env.GREENAPI_BASE_URL || DEFAULT_BASE).replace(/\/$/, ''), id, token };
}

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super('WhatsApp is not configured: set GREENAPI_ID_INSTANCE and GREENAPI_API_TOKEN.');
    this.name = 'WhatsAppNotConfiguredError';
  }
}

/**
 * Send a WhatsApp text. Throws rather than warning: a notification that
 * silently does not send is worse than one that fails loudly, because you
 * carry on believing the shop is being watched.
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const creds = credentials();
  if (!creds) throw new WhatsAppNotConfiguredError();

  const res = await fetch(`${creds.base}/waInstance${creds.id}/sendMessage/${creds.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: `${digitsOnly(to)}@c.us`, message: body }),
  });
  if (!res.ok) {
    throw new Error(`Green API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/**
 * Is the linked account actually authorized? Green API instances drop out of
 * "authorized" when the phone is offline too long or the QR is revoked, and
 * the only symptom otherwise is messages quietly not arriving.
 */
export async function whatsAppStatus(): Promise<{
  configured: boolean; state?: string; ok: boolean; detail?: string;
}> {
  const creds = credentials();
  if (!creds) return { configured: false, ok: false, detail: 'No Green API credentials set.' };
  try {
    const res = await fetch(`${creds.base}/waInstance${creds.id}/getStateInstance/${creds.token}`);
    if (!res.ok) {
      return { configured: true, ok: false, detail: `Green API ${res.status}` };
    }
    const data = await res.json();
    const state = data?.stateInstance as string | undefined;
    return {
      configured: true,
      state,
      ok: state === 'authorized',
      detail: state === 'authorized' ? undefined
        : `Instance is "${state}" — rescan the QR in the Green API console.`,
    };
  } catch (e) {
    return { configured: true, ok: false, detail: (e as Error).message };
  }
}

// ── Posting to the shop's own groups (Post a Piece) ──────────────────────────
// A piece goes to the community's announcements group from the same linked
// number the alerts use. The chat is a group id ("…@g.us") that the caller
// takes from configuration — never built from anything a request sends — so
// these can only ever reach the groups the shop has named.

/** Uploads go to the media host, as Green API recommends for sendFileByUpload. */
const DEFAULT_MEDIA = 'https://media.green-api.com';

/** One file, with the caption under it, to a group. Resolves to Green API's message id. */
export async function sendWhatsAppFileToGroup(chatId: string, file: Blob, fileName: string, caption = ''): Promise<string> {
  const creds = credentials();
  if (!creds) throw new WhatsAppNotConfiguredError();
  if (!/@g\.us$/.test(chatId)) throw new Error(`Not a group chat id: ${chatId}`);
  const media = (process.env.GREENAPI_MEDIA_URL || DEFAULT_MEDIA).replace(/\/$/, '');
  const form = new FormData();
  form.set('chatId', chatId);
  form.set('fileName', fileName);
  form.set('file', file, fileName);
  // WhatsApp shows a caption under images and caps it at 1024 characters.
  if (caption) form.set('caption', caption.slice(0, 1024));
  const res = await fetch(`${media}/waInstance${creds.id}/sendFileByUpload/${creds.token}`, { method: 'POST', body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Green API ${res.status}: ${text.slice(0, 200)}`);
  let data: { idMessage?: string } = {};
  try { data = JSON.parse(text); } catch { /* reported below */ }
  if (!data.idMessage) throw new Error(`Green API did not accept the file: ${text.slice(0, 200)}`);
  return data.idMessage;
}

/** A group's name and member count, for saying where a post is about to go. */
export async function whatsAppGroupInfo(chatId: string): Promise<{ name: string; size: number } | null> {
  const creds = credentials();
  if (!creds) return null;
  try {
    const res = await fetch(`${creds.base}/waInstance${creds.id}/getGroupData/${creds.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: chatId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { name: String(d?.subject || ''), size: Number(d?.size) || (Array.isArray(d?.participants) ? d.participants.length : 0) };
  } catch {
    return null;
  }
}

// ── Deep links to the WhatsApp app (client-side) ─────────────────────────────
// Distinct from sendWhatsAppMessage above, which posts through the bridge.
// The link-building and Pakistani number normalisation below were previously
// reimplemented in six files, in two slightly different ways: some stripped
// non-digits and used the result as-is, others prefixed 92 and dropped a
// leading 0. A number saved as "0300…" produced a working link on one screen
// and a dead one on another. This is the single rule.

/**
 * Digits only, with a Pakistan country code.
 *   0300 1234567 -> 923001234567
 *   +92 300 …    -> 923001234567
 *   300 1234567  -> 923001234567
 * Returns '' when there is nothing dialable.
 */
export function toWhatsAppNumber(phone: string | undefined | null): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('0')) return '92' + digits.replace(/^0+/, '');
  return '92' + digits;
}

/** wa.me link for a number and a prefilled message. '' if the number is unusable. */
export function whatsAppLink(phone: string | undefined | null, message = ''): string {
  const num = toWhatsAppNumber(phone);
  if (!num) return '';
  return `https://wa.me/${num}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

/**
 * Open WhatsApp in a new tab. Returns false when there is no usable number, so
 * callers can fall back to "copied to clipboard" instead of opening nothing.
 */
export function openWhatsApp(phone: string | undefined | null, message = ''): boolean {
  const url = whatsAppLink(phone, message);
  if (!url || typeof window === 'undefined') return false;
  window.open(url, '_blank');
  return true;
}
