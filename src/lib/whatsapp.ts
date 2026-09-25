/**
 * Outbound WhatsApp — through WAHA, or Green API until it is switched off.
 *
 * WAHA (WhatsApp HTTP API, waha.devlike.pro) is the shop's own gateway: a small
 * VM in gemstrack-pos (`waha`, ops/waha/) with the shop's line linked to it as a
 * device. It is chosen whenever WAHA_URL and WAHA_API_KEY are set (the owner's
 * switch, 2026-09-25); otherwise Green API, which stays configured as the
 * fallback until it is cancelled. One transport per deployment, never a silent
 * fall-through: which one is in use is `whatsAppProvider()`, and the checks
 * panel says so.
 *
 * Both are unofficial gateways: one linked account can message anyone, with no
 * per-recipient setup and no 24-hour window. That is the right trade for the
 * shop's own alerts and its own groups; customer-facing volume belongs on the
 * official Meta Cloud API with approved templates, or the number risks a ban.
 *
 * Configure (WAHA):
 *   WAHA_URL        https://… (no trailing slash needed)
 *   WAHA_API_KEY    the key the VM holds hashed (secret `waha-api-key`)
 *   WAHA_SESSION    optional, defaults to "default"
 * Configure (Green API, the fallback):
 *   GREENAPI_ID_INSTANCE, GREENAPI_API_TOKEN, GREENAPI_BASE_URL (optional)
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

function waha(): { base: string; key: string; session: string } | null {
  const base = (process.env.WAHA_URL || '').trim().replace(/\/$/, '');
  const key = (process.env.WAHA_API_KEY || '').trim();
  if (!base || !key) return null;
  return { base, key, session: (process.env.WAHA_SESSION || 'default').trim() };
}

/** Which gateway this deployment sends through. */
export function whatsAppProvider(): 'waha' | 'greenapi' | null {
  return waha() ? 'waha' : credentials() ? 'greenapi' : null;
}

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super('WhatsApp is not configured: set WAHA_URL and WAHA_API_KEY (or GREENAPI_ID_INSTANCE and GREENAPI_API_TOKEN).');
    this.name = 'WhatsAppNotConfiguredError';
  }
}

/** One WAHA call. Throws with WAHA's own message, prefixed so errors say where they came from. */
async function wahaCall<T = unknown>(path: string, init?: { method?: string; body?: unknown; timeoutMs?: number }): Promise<T> {
  const w = waha();
  if (!w) throw new WhatsAppNotConfiguredError();
  const res = await fetch(`${w.base}${path}`, {
    method: init?.method || (init?.body ? 'POST' : 'GET'),
    headers: { 'X-Api-Key': w.key, Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(init?.timeoutMs ?? 30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WAHA ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

/** WAHA's message id, whichever engine answered (GOWS, NOWEB and WEBJS shape it differently). */
function wahaMessageId(d: unknown): string {
  const o = (d || {}) as Record<string, unknown>;
  const id = o.id as unknown;
  if (typeof id === 'string' && id) return id;
  if (id && typeof id === 'object') {
    const io = id as Record<string, unknown>;
    if (typeof io._serialized === 'string') return io._serialized;
    if (typeof io.id === 'string') return io.id;
  }
  const key = o.key as Record<string, unknown> | undefined;
  if (key && typeof key.id === 'string') return key.id;
  throw new Error(`WAHA did not return a message id: ${JSON.stringify(d).slice(0, 200)}`);
}

/** Groups (…@g.us) and channels (…@newsletter) — the only chats the posting functions may reach. */
const isGroupOrChannel = (chatId: string) => /@(g\.us|newsletter)$/.test(chatId);

/**
 * Send a WhatsApp text. Throws rather than warning: a notification that
 * silently does not send is worse than one that fails loudly, because you
 * carry on believing the shop is being watched.
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const w = waha();
  if (w) {
    await wahaCall('/api/sendText', { body: { session: w.session, chatId: `${digitsOnly(to)}@c.us`, text: body } });
    return;
  }
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
 * Is the linked account actually signed in? A gateway drops out when the phone
 * is offline too long or the device is unlinked, and the only symptom otherwise
 * is messages quietly not arriving. `state` is the gateway's own word for it
 * (WAHA: WORKING, SCAN_QR_CODE, STARTING, FAILED, STOPPED; Green API: authorized, …).
 */
export async function whatsAppStatus(): Promise<{
  configured: boolean; state?: string; ok: boolean; detail?: string; provider?: 'waha' | 'greenapi';
}> {
  const w = waha();
  if (w) {
    try {
      const d = await wahaCall<{ status?: string }>(`/api/sessions/${encodeURIComponent(w.session)}`, { timeoutMs: 10000 });
      const state = d?.status;
      return {
        configured: true, provider: 'waha', state, ok: state === 'WORKING',
        detail: state === 'WORKING' ? undefined
          : state === 'SCAN_QR_CODE' ? 'The line is not linked to WAHA — link it again (WhatsApp → Linked devices).'
          : `WAHA session is "${state ?? 'unknown'}".`,
      };
    } catch (e) {
      return { configured: true, provider: 'waha', ok: false, detail: (e as Error).message };
    }
  }
  const creds = credentials();
  if (!creds) return { configured: false, ok: false, detail: 'No WhatsApp gateway is set (WAHA or Green API).' };
  try {
    const res = await fetch(`${creds.base}/waInstance${creds.id}/getStateInstance/${creds.token}`);
    if (!res.ok) {
      return { configured: true, provider: 'greenapi', ok: false, detail: `Green API ${res.status}` };
    }
    const data = await res.json();
    const state = data?.stateInstance as string | undefined;
    return {
      configured: true,
      provider: 'greenapi',
      state,
      ok: state === 'authorized',
      detail: state === 'authorized' ? undefined
        : `Instance is "${state}" — rescan the QR in the Green API console.`,
    };
  } catch (e) {
    return { configured: true, provider: 'greenapi', ok: false, detail: (e as Error).message };
  }
}

// ── Posting to the shop's own groups and channel (Post a Piece) ─────────────
// A piece goes to the community's announcements group, and to the shop's
// WhatsApp channel when one is set, from the same linked number the alerts use.
// The chat is a group id ("…@g.us") or a channel id ("…@newsletter") that the
// caller takes from configuration — never built from anything a request sends —
// so these can only ever reach the chats the shop has named. Channels need WAHA
// (Green API has no channels).

/** Uploads go to the media host, as Green API recommends for sendFileByUpload. */
const DEFAULT_MEDIA = 'https://media.green-api.com';

/** One file, with the caption under it, to a group or channel. Resolves to the gateway's message id. */
export async function sendWhatsAppFileToGroup(chatId: string, file: Blob, fileName: string, caption = ''): Promise<string> {
  if (!isGroupOrChannel(chatId)) throw new Error(`Not a group or channel chat id: ${chatId}`);
  // WhatsApp shows a caption under images and caps it at 1024 characters.
  const cap = caption ? caption.slice(0, 1024) : '';
  const w = waha();
  if (w) {
    const mimetype = file.type || (/\.png$/i.test(fileName) ? 'image/png' : 'image/jpeg');
    const data = Buffer.from(await file.arrayBuffer()).toString('base64');
    const endpoint = /^image\//.test(mimetype) ? '/api/sendImage' : '/api/sendFile';
    const res = await wahaCall(endpoint, {
      body: { session: w.session, chatId, file: { mimetype, filename: fileName, data }, ...(cap ? { caption: cap } : {}) },
      timeoutMs: 90000,
    });
    return wahaMessageId(res);
  }
  const creds = credentials();
  if (!creds) throw new WhatsAppNotConfiguredError();
  if (!/@g\.us$/.test(chatId)) throw new Error('Green API cannot post to a WhatsApp channel — that needs WAHA.');
  const media = (process.env.GREENAPI_MEDIA_URL || DEFAULT_MEDIA).replace(/\/$/, '');
  const form = new FormData();
  form.set('chatId', chatId);
  form.set('fileName', fileName);
  form.set('file', file, fileName);
  if (cap) form.set('caption', cap);
  const res = await fetch(`${media}/waInstance${creds.id}/sendFileByUpload/${creds.token}`, { method: 'POST', body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`Green API ${res.status}: ${text.slice(0, 200)}`);
  let data: { idMessage?: string } = {};
  try { data = JSON.parse(text); } catch { /* reported below */ }
  if (!data.idMessage) throw new Error(`Green API did not accept the file: ${text.slice(0, 200)}`);
  return data.idMessage;
}

/** A text message to a group or channel (the Investments post, the community teaser). Resolves to the message id. */
export async function sendWhatsAppTextToGroup(chatId: string, text: string): Promise<string> {
  if (!isGroupOrChannel(chatId)) throw new Error(`Not a group or channel chat id: ${chatId}`);
  const w = waha();
  if (w) return wahaMessageId(await wahaCall('/api/sendText', { body: { session: w.session, chatId, text } }));
  const creds = credentials();
  if (!creds) throw new WhatsAppNotConfiguredError();
  if (!/@g\.us$/.test(chatId)) throw new Error('Green API cannot post to a WhatsApp channel — that needs WAHA.');
  const res = await fetch(`${creds.base}/waInstance${creds.id}/sendMessage/${creds.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message: text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Green API ${res.status}: ${body.slice(0, 200)}`);
  let data: { idMessage?: string } = {};
  try { data = JSON.parse(body); } catch { /* reported below */ }
  if (!data.idMessage) throw new Error(`Green API did not accept the message: ${body.slice(0, 200)}`);
  return data.idMessage;
}

/** A member. `id` is often a LID (…@lid, WhatsApp's private id) in communities; `pn` is the phone (…@c.us). */
type WahaParticipant = { id?: string; pn?: string; role?: string };

/** A WAHA group: its name and its members with their roles (admin, superadmin, participant). */
async function wahaGroup(chatId: string): Promise<{ name: string; participants: WahaParticipant[] } | null> {
  const w = waha();
  if (!w) return null;
  const s = encodeURIComponent(w.session), g = encodeURIComponent(chatId);
  try {
    const [info, members] = await Promise.all([
      wahaCall<Record<string, unknown>>(`/api/${s}/groups/${g}`, { timeoutMs: 10000 }),
      wahaCall<WahaParticipant[]>(`/api/${s}/groups/${g}/participants/v2`, { timeoutMs: 10000 }).catch(() => [] as WahaParticipant[]),
    ]);
    const meta = (info?.groupMetadata || {}) as Record<string, unknown>;
    const name = String(info?.subject || info?.Name || info?.name || meta.subject || '');
    return { name, participants: Array.isArray(members) ? members : [] };
  } catch {
    return null;
  }
}

/** A group's name and member count, for saying where a post is about to go. */
export async function whatsAppGroupInfo(chatId: string): Promise<{ name: string; size: number } | null> {
  if (waha()) {
    const g = await wahaGroup(chatId);
    return g ? { name: g.name, size: g.participants.filter(p => p.role !== 'left').length } : null;
  }
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

/** The shop's WhatsApp channel: its name and the line's role in it (it must be OWNER or ADMIN to post). WAHA only. */
export async function whatsAppChannelInfo(channelId: string): Promise<{ name: string; role: string | null; followers: number | null } | null> {
  const w = waha();
  if (!w || !/@newsletter$/.test(channelId)) return null;
  try {
    const d = await wahaCall<Record<string, unknown>>(`/api/${encodeURIComponent(w.session)}/channels/${encodeURIComponent(channelId)}`, { timeoutMs: 10000 });
    const followers = Number(d?.subscribersCount ?? d?.followers ?? NaN);
    return { name: String(d?.name || ''), role: d?.role ? String(d.role) : null, followers: Number.isFinite(followers) ? followers : null };
  } catch {
    return null;
  }
}

/**
 * For the Post a Piece checks: the linked number, the group's admins, and how
 * many messages are waiting to go out (Green API queues while the phone is
 * offline; WAHA sends straight away, so it reports `queued: null` and
 * `provider: 'waha'`). Nulls when the gateway cannot be reached. Admins are
 * plain digits, so any id form (@c.us, @s.whatsapp.net) compares.
 */
export async function whatsAppDiagnostics(chatId?: string): Promise<{
  provider: 'waha' | 'greenapi' | null;
  phone: string | null; queued: number | null; group: { name: string; size: number; admins: string[] } | null;
}> {
  const w = waha();
  if (w) {
    const [me, group] = await Promise.all([
      wahaCall<{ id?: string }>(`/api/sessions/${encodeURIComponent(w.session)}/me`, { timeoutMs: 10000 }).catch(() => null),
      chatId ? wahaGroup(chatId) : Promise.resolve(null),
    ]);
    const phone = me?.id ? digitsOnly(String(me.id).split(/[@:]/)[0]) : null;
    return {
      provider: 'waha',
      phone: phone || null,
      queued: null,
      group: group ? {
        name: group.name,
        size: group.participants.filter(p => p.role !== 'left').length,
        // By phone: members are listed by LID, which is not the number; `pn` is.
        admins: group.participants.filter(p => p.role === 'admin' || p.role === 'superadmin').map(p => digitsOnly(String(p.pn || p.id || '').split(/[@:]/)[0])),
      } : null,
    };
  }
  const creds = credentials();
  if (!creds) return { provider: null, phone: null, queued: null, group: null };
  const get = async (method: string, body?: unknown) => {
    try {
      const res = await fetch(`${creds.base}/waInstance${creds.id}/${method}/${creds.token}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const [settings, queue, group] = await Promise.all([
    get('getWaSettings'),
    get('showMessagesQueue'),
    chatId ? get('getGroupData', { groupId: chatId }) : Promise.resolve(null),
  ]);
  const participants: Array<{ id: string; isAdmin?: boolean; isSuperAdmin?: boolean }> = Array.isArray(group?.participants) ? group.participants : [];
  return {
    provider: 'greenapi',
    phone: settings?.phone ? String(settings.phone) : null,
    queued: Array.isArray(queue) ? queue.length : null,
    group: group ? {
      name: String(group.subject || ''),
      size: Number(group.size) || participants.length,
      admins: participants.filter(p => p.isAdmin || p.isSuperAdmin).map(p => digitsOnly(String(p.id).split(/[@:]/)[0])),
    } : null,
  };
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
