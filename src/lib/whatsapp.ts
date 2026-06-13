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
 * Sends a WhatsApp text message. Prefers CallMeBot (simple, no Meta business
 * verification / templates / 24h window) when a per-recipient key is configured
 * via CALLMEBOT_KEYS; otherwise falls back to the Meta Business Cloud API
 * (WHATSAPP_TOKEN + WHATSAPP_PHONE_ID). Call only from server-side code.
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
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

  console.warn(`[WhatsApp] No CallMeBot key for ${to} and Meta creds not set — skipping notification.`);
}
