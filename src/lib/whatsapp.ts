const GRAPH_API = 'https://graph.facebook.com/v22.0';

/**
 * Sends a WhatsApp text message via the Meta Business Cloud API.
 * Uses WHATSAPP_TOKEN and WHATSAPP_PHONE_ID from server environment variables.
 * Call this only from server-side code (API routes).
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.warn('[WhatsApp] WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not set — skipping notification.');
    return;
  }

  const res = await fetch(`${GRAPH_API}/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${err}`);
  }
}
