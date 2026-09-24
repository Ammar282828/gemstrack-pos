/**
 * Posting a story to the shop's Instagram, through Instagram's own API
 * ("Instagram API with Instagram Login" — no Facebook Page needed, which is
 * why this route and not the older Facebook-login one: @collectionstaheri is
 * a Business account with no Page).
 *
 * Connecting is once: the counter presses Connect, Instagram asks the account
 * holder to approve, and the callback swaps the code for a 60-day token. The
 * token lives in Secret Manager (INSTAGRAM_TOKEN_SECRET, default
 * "instagram-token"), never in Firestore — this app's Firestore rules are open,
 * and a token there would let anyone post as the shop. It is renewed on use
 * once it has under 20 days left, so a shop that posts at least monthly never
 * has to reconnect. The App Hosting account needs secretAccessor and
 * secretVersionAdder on that one secret.
 *
 * INSTAGRAM_USERNAME locks the connection to the shop's own account: under
 * open access anyone could press Connect, and without the lock whoever did
 * could point the shop's stories at their own profile.
 *
 * Instagram fetches the image itself from a public URL, JPEG only; the caller
 * provides one (see /api/public/social/[id]). Stories take no caption and no
 * stickers through the API — the link sticker stays a tap in the app.
 *
 * Server-only.
 */

import { GoogleAuth } from 'google-auth-library';

const APP_ID = () => process.env.INSTAGRAM_APP_ID?.trim() || '';
const APP_SECRET = () => process.env.INSTAGRAM_APP_SECRET?.trim() || '';
const USERNAME = () => (process.env.INSTAGRAM_USERNAME || '').trim().replace(/^@/, '').toLowerCase();
const VERSION = () => process.env.INSTAGRAM_GRAPH_VERSION?.trim() || 'v23.0';
const SECRET = () => process.env.INSTAGRAM_TOKEN_SECRET?.trim() || 'instagram-token';
const PROJECT = () => process.env.GOOGLE_CLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
const GRAPH = 'https://graph.instagram.com';
const RENEW_BEFORE_MS = 20 * 86_400_000;

export class InstagramError extends Error {
  constructor(message: string, public status = 502) { super(message); this.name = 'InstagramError'; }
}

export const instagramConfigured = () => Boolean(APP_ID() && APP_SECRET());

export interface Connection { token: string; userId: string; username: string; expiresAt: string; connectedAt: string }

// ── Secret Manager, by REST (no extra dependency) ──────────────────────────

const gauth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
async function sm(path: string, init?: RequestInit): Promise<Response> {
  const token = (await (await gauth.getClient()).getAccessToken()).token;
  return fetch(`https://secretmanager.googleapis.com/v1/projects/${PROJECT()}/secrets/${SECRET()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
}

let cached: { at: number; conn: Connection | null } | null = null;

export async function loadConnection(): Promise<Connection | null> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.conn;
  const res = await sm('/versions/latest:access');
  if (res.status === 404 || res.status === 400) { cached = { at: Date.now(), conn: null }; return null; }
  if (!res.ok) throw new InstagramError(`Could not read the Instagram connection (${res.status}).`, 503);
  const d = await res.json();
  try {
    const conn = JSON.parse(Buffer.from(d.payload.data, 'base64').toString('utf8')) as Connection;
    cached = { at: Date.now(), conn };
    return conn;
  } catch {
    return null;
  }
}

async function saveConnection(conn: Connection): Promise<void> {
  const res = await sm(':addVersion', { method: 'POST', body: JSON.stringify({ payload: { data: Buffer.from(JSON.stringify(conn)).toString('base64') } }) });
  if (!res.ok) throw new InstagramError(`Could not save the Instagram connection (${res.status}: ${(await res.text()).slice(0, 160)}).`, 503);
  cached = { at: Date.now(), conn };
}

// ── Connecting ─────────────────────────────────────────────────────────────

export const redirectUri = (origin: string) => `${origin.replace(/\/+$/, '')}/api/instagram/callback`;

export function authorizeUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    enable_fb_login: '0',
    force_reauth: 'true',
    client_id: APP_ID(),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish',
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

async function igJson(res: Response): Promise<Record<string, unknown>> {
  const d = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || d.error || d.error_message) {
    const e = (d.error ?? {}) as { message?: string };
    throw new InstagramError(String(e.message || d.error_message || `Instagram returned ${res.status}`).slice(0, 300), res.status >= 400 ? res.status : 502);
  }
  return d;
}

/**
 * The code for a short-lived token — once: Instagram spends a code on the first
 * exchange even when it refuses it, so there is no second try. When this says
 * "redirect_uri is identical…" while the URIs plainly are, the usual cause is
 * the secret: INSTAGRAM_APP_SECRET must be the *Instagram* app secret from
 * "API setup with Instagram login", not the Meta app's secret from Basic
 * settings (the two look alike; 2026-09-24 was lost to exactly that).
 */
async function exchangeCode(origin: string, code: string): Promise<Record<string, unknown>> {
  try {
    return await igJson(await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: APP_ID(), client_secret: APP_SECRET(), grant_type: 'authorization_code', redirect_uri: redirectUri(origin), code }),
    }));
  } catch (e) {
    console.warn('[instagram] code exchange refused:', e instanceof Error ? e.message : e);
    throw e;
  }
}

/** The code from the redirect → a 60-day token for the approved account, saved. */
export async function completeConnection(origin: string, rawCode: string): Promise<Connection> {
  const code = rawCode.replace(/#_$/, '');
  const short = await exchangeCode(origin, code);
  const long = await igJson(await fetch(`${GRAPH}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: APP_SECRET(), access_token: String(short.access_token) })}`));
  const token = String(long.access_token);
  const me = await igJson(await fetch(`${GRAPH}/${VERSION()}/me?${new URLSearchParams({ fields: 'user_id,username,account_type', access_token: token })}`));
  const username = String(me.username || '');
  if (USERNAME() && username.toLowerCase() !== USERNAME()) {
    throw new InstagramError(`That was @${username}. Only @${USERNAME()} can be connected here — sign in to Instagram as the shop and try again.`, 403);
  }
  const conn: Connection = {
    token,
    userId: String(me.user_id || short.user_id),
    username,
    expiresAt: new Date(Date.now() + Number(long.expires_in || 5_184_000) * 1000).toISOString(),
    connectedAt: new Date().toISOString(),
  };
  await saveConnection(conn);
  return conn;
}

/** The connection, renewed first if it is running out. */
export async function freshConnection(): Promise<Connection> {
  const conn = await loadConnection();
  if (!conn) throw new InstagramError('Instagram is not connected yet.', 409);
  const left = new Date(conn.expiresAt).getTime() - Date.now();
  if (left <= 0) throw new InstagramError('The Instagram connection has expired. Connect it again.', 409);
  if (left < RENEW_BEFORE_MS) {
    try {
      const r = await igJson(await fetch(`${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: conn.token })}`));
      const renewed = { ...conn, token: String(r.access_token), expiresAt: new Date(Date.now() + Number(r.expires_in || 5_184_000) * 1000).toISOString() };
      await saveConnection(renewed);
      return renewed;
    } catch (e) {
      // The old token still works until it expires; renewing can wait for the next post.
      console.warn('[instagram] renewal failed:', e instanceof Error ? e.message : e);
    }
  }
  return conn;
}

// ── Posting ────────────────────────────────────────────────────────────────

/** A story from a public JPEG URL. Resolves to the new media's id. */
export async function publishStory(imageUrl: string): Promise<string> {
  const conn = await freshConnection();
  const v = VERSION();
  const container = await igJson(await fetch(`${GRAPH}/${v}/${conn.userId}/media`, {
    method: 'POST',
    body: new URLSearchParams({ image_url: imageUrl, media_type: 'STORIES', access_token: conn.token }),
  }));
  const id = String(container.id);
  // Images are usually ready at once; give Instagram up to half a minute.
  for (let i = 0; i < 15; i++) {
    const s = await igJson(await fetch(`${GRAPH}/${v}/${id}?${new URLSearchParams({ fields: 'status_code,status', access_token: conn.token })}`));
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new InstagramError(`Instagram could not take the image: ${String(s.status || s.status_code)}`, 422);
    await new Promise(r => setTimeout(r, 2000));
  }
  const published = await igJson(await fetch(`${GRAPH}/${v}/${conn.userId}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: id, access_token: conn.token }),
  }));
  return String(published.id);
}

// ── For the checks panel ───────────────────────────────────────────────────

export interface InstagramHealth {
  username: string;
  daysLeft: number;
  /** Posts published through the API in the last 24 hours, and the cap. */
  quota: { used: number; total: number } | null;
}

/** Is the saved token still good, whose is it, and how much of today's allowance is used? Throws Instagram's own error when the token is bad. */
export async function instagramHealth(): Promise<InstagramHealth | null> {
  const conn = await loadConnection();
  if (!conn) return null;
  const v = VERSION();
  const me = await igJson(await fetch(`${GRAPH}/${v}/me?${new URLSearchParams({ fields: 'user_id,username', access_token: conn.token })}`, { signal: AbortSignal.timeout(8000) }));
  let quota: InstagramHealth['quota'] = null;
  try {
    const q = await igJson(await fetch(`${GRAPH}/${v}/${conn.userId}/content_publishing_limit?${new URLSearchParams({ fields: 'quota_usage,config', access_token: conn.token })}`, { signal: AbortSignal.timeout(8000) }));
    const row = (q.data as Array<{ quota_usage?: number; config?: { quota_total?: number } }> | undefined)?.[0];
    if (row) quota = { used: Number(row.quota_usage ?? 0), total: Number(row.config?.quota_total ?? 100) };
  } catch { /* the limit is advice; the token check above is what matters */ }
  return {
    username: String(me.username || conn.username),
    daysLeft: Math.floor((new Date(conn.expiresAt).getTime() - Date.now()) / 86_400_000),
    quota,
  };
}

/** Can this deployment read and add versions to the token secret? (Connect and renewal both need to.) */
export async function tokenStoreAccess(): Promise<{ read: boolean; write: boolean }> {
  const res = await sm(':testIamPermissions', { method: 'POST', body: JSON.stringify({ permissions: ['secretmanager.versions.access', 'secretmanager.versions.add'] }) });
  if (!res.ok) return { read: false, write: false };
  const granted: string[] = (await res.json()).permissions ?? [];
  return { read: granted.includes('secretmanager.versions.access'), write: granted.includes('secretmanager.versions.add') };
}
