/**
 * Point a WAHA session's incoming messages at the ERP (app/api/whatsapp/inbound), signed with the key both
 * derive from WAHA_API_KEY (lib/whatsapp-inbound-key.ts). Keeps the session's other settings; re-running is
 * harmless. WAHA restarts the session to apply it (a few seconds; it stays linked).
 *
 *   WAHA_API_KEY=… npx tsx scripts/waha-inbound-webhook.ts mina https://erp.houseofmina.store          (dry run)
 *   WAHA_API_KEY=… npx tsx scripts/waha-inbound-webhook.ts mina https://erp.houseofmina.store --apply
 */
import { inboundHmacKey } from '../src/lib/whatsapp-inbound-key';

const [session, erp, flag] = process.argv.slice(2);
const base = (process.env.WAHA_URL || 'https://35-184-20-165.sslip.io').replace(/\/$/, '');
const key = (process.env.WAHA_API_KEY || '').trim();
if (!session || !erp || !key) { console.error('usage: WAHA_API_KEY=… npx tsx scripts/waha-inbound-webhook.ts <session> <erp origin> [--apply]'); process.exit(1); }

(async () => {
  const h = { 'X-Api-Key': key, 'Content-Type': 'application/json' };
  const cur = await (await fetch(`${base}/api/sessions/${session}`, { headers: h })).json();
  const url = `${erp.replace(/\/$/, '')}/api/whatsapp/inbound`;
  const others = (cur?.config?.webhooks || []).filter((w: { url?: string }) => w.url !== url);
  const config = {
    ...(cur?.config || {}),
    webhooks: [...others, {
      url, events: ['message'], hmac: { key: inboundHmacKey(key) },
      retries: { policy: 'exponential', delaySeconds: 2, attempts: 4 },
    }],
  };
  console.log(`${session} (${cur?.status}): webhooks → ${config.webhooks.map((w: { url: string }) => w.url).join(', ')}`);
  if (flag !== '--apply') { console.log('dry run: add --apply'); return; }
  const r = await fetch(`${base}/api/sessions/${session}`, { method: 'PUT', headers: h, body: JSON.stringify({ name: session, config }) });
  console.log('PUT', r.status, r.ok ? 'done' : (await r.text()).slice(0, 300));
})().catch(e => { console.error(e); process.exit(1); });
