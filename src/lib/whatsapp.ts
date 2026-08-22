const GRAPH_API = 'https://graph.facebook.com/v22.0';
const CALLMEBOT_API = 'https://api.callmebot.com/whatsapp.php';

/** Strip everything but digits so "+92 326..." and "92326..." match the same key. */
function digitsOnly(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Per-recipient CallMeBot API keys, configured via the CALLMEBOT_KEYS env var
 * as a JSON object mapping phone → apikey, e.g.
 *   {"923262275554":"123456","923161930960":"789012"}
 * Each recipient gets their own key by messaging the CallMeBot WhatsApp number
 * once ("I allow callmebot to send me messages"). Keys are matched digits-only.
 */
function getCallMeBotKey(to: string): string | null {
  const raw = process.env.CALLMEBOT_KEYS;
  if (!raw) return null;
  let map: Record<string, string>;
  try {
    map = JSON.parse(raw);
  } catch {
    console.warn('[WhatsApp] CALLMEBOT_KEYS is not valid JSON.');
    return null;
  }
  const want = digitsOnly(to);
  for (const [phone, key] of Object.entries(map)) {
    if (digitsOnly(phone) === want) return key;
  }
  return null;
}

/**
 * Local bridge — a self-hosted whatsapp-web.js service running on this machine
 * (see whatsapp-local-service.js). Sends through a linked WhatsApp account with
 * no third-party gateway. Configure via WHATSAPP_LOCAL_URL, e.g.
 *   WHATSAPP_LOCAL_URL=http://localhost:4001/send
 */
async function sendViaLocalBridge(to: string, body: string, url: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: digitsOnly(to), message: body }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Local WhatsApp bridge error ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * Green API — unofficial WhatsApp gateway. One account is linked as the sender
 * (QR scan), then it can message anyone with no per-recipient setup, templates,
 * or 24h window. Configure via:
 *   GREENAPI_ID_INSTANCE   — instance id (e.g. "7103xxxxxx")
 *   GREENAPI_API_TOKEN     — API token for that instance
 *   GREENAPI_BASE_URL      — optional, defaults to https://api.green-api.com
 */
async function sendViaGreenApi(to: string, body: string, idInstance: string, apiToken: string): Promise<void> {
  const base = (process.env.GREENAPI_BASE_URL || 'https://api.green-api.com').replace(/\/$/, '');
  const chatId = `${digitsOnly(to)}@c.us`;
  const url = `${base}/waInstance${idInstance}/sendMessage/${apiToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message: body }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Green API error ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function sendViaCallMeBot(to: string, body: string, apikey: string): Promise<void> {
  const phone = to.startsWith('+') ? to : `+${digitsOnly(to)}`;
  const url = `${CALLMEBOT_API}?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(body)}&apikey=${encodeURIComponent(apikey)}`;
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  // CallMeBot returns 200 with an HTML/text body; treat explicit error markers as failures.
  if (!res.ok || /APIKey is invalid|not registered|error/i.test(text)) {
    throw new Error(`CallMeBot error ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function sendViaMeta(to: string, body: string, token: string, phoneId: string): Promise<void> {
  const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
  if (!res.ok) {
    throw new Error(`WhatsApp API error ${res.status}: ${await res.text()}`);
  }
}

/**
 * Sends a WhatsApp text message. Transport priority:
 *   1. Local bridge — if WHATSAPP_LOCAL_URL is set (self-hosted whatsapp-web.js)
 *   2. Green API    — if GREENAPI_ID_INSTANCE + GREENAPI_API_TOKEN are set
 *   3. CallMeBot    — if a per-recipient key is configured via CALLMEBOT_KEYS
 *   4. Meta Cloud   — if WHATSAPP_TOKEN + WHATSAPP_PHONE_ID are set
 * Call only from server-side code.
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const localUrl = process.env.WHATSAPP_LOCAL_URL;
  if (localUrl) {
    await sendViaLocalBridge(to, body, localUrl);
    return;
  }

  const greenId = process.env.GREENAPI_ID_INSTANCE;
  const greenToken = process.env.GREENAPI_API_TOKEN;
  if (greenId && greenToken) {
    await sendViaGreenApi(to, body, greenId, greenToken);
    return;
  }

  const callMeBotKey = getCallMeBotKey(to);
  if (callMeBotKey) {
    await sendViaCallMeBot(to, body, callMeBotKey);
    return;
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (token && phoneId) {
    await sendViaMeta(to, body, token, phoneId);
    return;
  }

  console.warn(`[WhatsApp] No transport configured for ${to} — skipping notification.`);
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
