/**
 * MINA — Local WhatsApp Sender (whatsapp-web.js)
 *
 * Runs entirely on your machine. Links your WhatsApp account once via QR,
 * then exposes a tiny HTTP endpoint the POS + scheduler use to send messages.
 * No Meta, no Green API, no third-party gateway.
 *
 * Setup (one time):
 *   npm install                      # installs whatsapp-web.js + qrcode-terminal
 *   node whatsapp-local-service.js   # scan the QR with WhatsApp → Linked Devices
 *
 * The session is saved under .wwebjs_auth/ so you only scan once.
 *
 * Then in .env.local add:
 *   WHATSAPP_LOCAL_URL=http://localhost:4001/send
 *
 * Endpoints:
 *   GET  /health          → { ready: true|false }
 *   POST /send  {to, message}  → sends a WhatsApp text (to = digits, e.g. 923262275554)
 *
 * Run alongside `npm run dev` (and notifications-scheduler.js for the 9 PM report).
 */

const http = require('http');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const PORT = process.env.WHATSAPP_LOCAL_PORT || 4001;

let ready = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  console.log('\n[WA] Scan this QR with WhatsApp → Settings → Linked Devices → Link a Device:\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('[WA] Authenticated.'));
client.on('ready', () => { ready = true; console.log(`[WA] Ready. Sender linked. Listening on http://localhost:${PORT}`); });
client.on('auth_failure', (m) => console.error('[WA] Auth failure:', m));
client.on('disconnected', (r) => { ready = false; console.warn('[WA] Disconnected:', r); });

client.initialize();

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  // Only accept connections from this machine.
  const remote = req.socket.remoteAddress || '';
  if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(remote)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready }));
    return;
  }

  if (req.method === 'POST' && req.url === '/send') {
    try {
      if (!ready) { res.writeHead(503).end('WhatsApp not ready (still linking?)'); return; }
      const { to, message } = JSON.parse((await readBody(req)) || '{}');
      if (!to || !message) { res.writeHead(400).end('Missing to or message'); return; }
      const digits = String(to).replace(/\D/g, '');
      const chatId = `${digits}@c.us`;
      await client.sendMessage(chatId, message);
      console.log(`[WA] Sent to ${digits} (${message.length} chars)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error('[WA] Send failed:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, '127.0.0.1', () => console.log(`[WA] HTTP bridge starting on http://localhost:${PORT} …`));
