/**
 * Meta ads (the Marketing API) for this house: the connection, and every call
 * to graph.facebook.com.
 *
 * One Meta app serves both houses (META_APP_ID, in the shared apphosting.yaml);
 * each house connects its own Facebook login in its own POS and keeps its own
 * token in its own project's Secret Manager (META_ADS_TOKEN_SECRET, default
 * "meta-ads-token") — never in Firestore, whose rules are open: a token there
 * would let anyone spend the shop's money. Which ad account, Page and Instagram
 * account this house advertises from is not secret and lives in Firestore
 * (settings.ts).
 *
 * Connecting is a Facebook Login (the Connect button → /api/ads/callback),
 * which gives a user token good for about 60 days; the page warns before it
 * runs out. A System User token from Business Settings never expires: paste it
 * as a new version of the token secret (the raw "EAA…" text is enough) and the
 * page picks it up.
 *
 * The Meta app secret signs every call (appsecret_proof) and is needed to
 * connect. It is read from META_APP_SECRET when declared, otherwise straight
 * from Secret Manager ("meta-app-secret"), so a missing value is a setup step
 * on the page rather than a failed rollout.
 *
 * Server-only.
 */

import { createHmac } from 'crypto';
import { readSecret, addSecretVersion } from '@/lib/secret-manager';

/** v26.0 (2026-07-29); its breaking changes reach every version on 2026-10-27 anyway. */
export const GRAPH_VERSION = () => process.env.META_GRAPH_VERSION?.trim() || 'v26.0';
export const META_APP_ID = () => (process.env.META_APP_ID || process.env.INSTAGRAM_META_APP_ID || '').trim();
export const TOKEN_SECRET = () => process.env.META_ADS_TOKEN_SECRET?.trim() || 'meta-ads-token';
export const APP_SECRET_NAME = () => process.env.META_APP_SECRET_NAME?.trim() || 'meta-app-secret';
/** Facebook Login for Business configuration, when the app uses one instead of plain scopes. */
const LOGIN_CONFIG_ID = () => process.env.META_LOGIN_CONFIG_ID?.trim() || '';
const GRAPH = 'https://graph.facebook.com';

/** What the POS asks Facebook for: read and run ads, see the Pages and Instagram accounts to run them as. */
export const SCOPES = [
  'ads_management', 'ads_read', 'business_management',
  'pages_show_list', 'pages_read_engagement', 'pages_manage_ads',
  'instagram_basic',
];
/** Without these nothing on the Ads pages works; the rest only limit what can be created. */
export const ESSENTIAL_SCOPES = ['ads_read'];

export class MetaAdsError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code?: number,
    public subcode?: number,
    public fbtrace?: string,
  ) { super(message); this.name = 'MetaAdsError'; }
}

// ── The app secret ─────────────────────────────────────────────────────────

let secretCache: { at: number; value: string | null } | null = null;
export async function appSecret(): Promise<string | null> {
  const env = process.env.META_APP_SECRET?.trim();
  if (env) return env;
  if (secretCache && Date.now() - secretCache.at < 10 * 60_000) return secretCache.value;
  const value = (await readSecret(APP_SECRET_NAME()).catch(() => null))?.trim() || null;
  secretCache = { at: Date.now(), value };
  return value;
}

// ── The connection ─────────────────────────────────────────────────────────

export interface AdsConnection {
  token: string;
  /** A person's login (≈60 days) or a Business Settings system user (no expiry). */
  kind: 'user' | 'system';
  userId: string;
  userName: string;
  /** ISO time the token stops working; null when it never does. */
  expiresAt: string | null;
  scopes: string[];
  connectedAt: string;
}

let connCache: { at: number; conn: AdsConnection | null } | null = null;

export async function loadConnection(fresh = false): Promise<AdsConnection | null> {
  if (!fresh && connCache && Date.now() - connCache.at < 5 * 60_000) return connCache.conn;
  const raw = (await readSecret(TOKEN_SECRET()))?.trim() || '';
  let conn: AdsConnection | null = null;
  if (raw.startsWith('{')) {
    try { conn = JSON.parse(raw) as AdsConnection; } catch { conn = null; }
    if (conn && !conn.token) conn = null; // "{}" = disconnected
  } else if (raw) {
    // A token pasted into Secret Manager by hand — a system user's, as a rule.
    conn = { token: raw, kind: 'system', userId: '', userName: '', expiresAt: null, scopes: [], connectedAt: '' };
  }
  connCache = { at: Date.now(), conn };
  return conn;
}

async function saveConnection(conn: AdsConnection | null): Promise<void> {
  await addSecretVersion(TOKEN_SECRET(), JSON.stringify(conn ?? {}));
  connCache = { at: Date.now(), conn };
}

export const disconnect = () => saveConnection(null);

/** The connection, or an error the page can act on. */
export async function requireConnection(): Promise<AdsConnection> {
  const conn = await loadConnection();
  if (!conn) throw new MetaAdsError('Meta ads are not connected yet. Connect them on the Setup tab.', 409);
  if (conn.expiresAt && Date.parse(conn.expiresAt) <= Date.now()) {
    throw new MetaAdsError('The Meta connection has expired. Connect it again on the Setup tab.', 409, 190);
  }
  return conn;
}

// ── Calling the Graph API ──────────────────────────────────────────────────

type Params = Record<string, unknown>;

function encode(params: Params): URLSearchParams {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return q;
}

/** Meta's error, in the words it gives the person (error_user_msg) when it gives any. */
export function metaError(body: unknown, httpStatus: number): MetaAdsError {
  const e = ((body as { error?: Record<string, unknown> })?.error ?? {}) as Record<string, unknown>;
  const code = typeof e.code === 'number' ? e.code : undefined;
  const subcode = typeof e.error_subcode === 'number' ? e.error_subcode : undefined;
  const title = String(e.error_user_title || '').trim();
  const userMsg = String(e.error_user_msg || '').trim();
  const message = String(e.message || `Meta answered ${httpStatus}`).trim();
  const text = userMsg ? (title && !userMsg.startsWith(title) ? `${title}: ${userMsg}` : userMsg) : message;
  const status =
    code === 190 || code === 102 ? 401 :
    code === 10 || code === 200 || (code !== undefined && code >= 200 && code < 300) || code === 294 ? 403 :
    code === 4 || code === 17 || code === 32 || code === 613 || code === 80000 || code === 80003 || code === 80004 ? 429 :
    code === 100 || code === 1487 || code === 2635 ? 400 :
    httpStatus >= 400 ? httpStatus : 502;
  return new MetaAdsError(text.slice(0, 600), status, code, subcode, typeof e.fbtrace_id === 'string' ? e.fbtrace_id : undefined);
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body && typeof body === 'object' && 'error' in body)) throw metaError(body, res.status);
  return body as T;
}

export interface GraphOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  params?: Params;
  /** Another token than the connection's (the connect flow's own calls). */
  token?: string;
  timeoutMs?: number;
}

/** One Graph API call as this house's connection. `path` is "act_1/campaigns", "12345", "me/adaccounts"… */
export async function graph<T = Record<string, unknown>>(path: string, opts: GraphOptions = {}): Promise<T> {
  const token = opts.token ?? (await requireConnection()).token;
  const secret = await appSecret();
  const params: Params = { ...(opts.params ?? {}), access_token: token };
  if (secret) params.appsecret_proof = createHmac('sha256', secret).update(token).digest('hex');
  const method = opts.method ?? 'GET';
  const url = `${GRAPH}/${GRAPH_VERSION()}/${path.replace(/^\/+/, '')}`;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = method === 'POST'
      ? await fetch(url, { method, body: encode(params), signal })
      : await fetch(`${url}?${encode(params)}`, { method, signal });
  } catch (e) {
    throw new MetaAdsError(`Couldn't reach Meta (${e instanceof Error ? e.message : 'network error'}).`, 504);
  }
  try {
    return await parse<T>(res);
  } catch (e) {
    if (e instanceof MetaAdsError && e.code === 190 && !opts.token) connCache = null; // re-read the secret next time
    throw e;
  }
}

/** Every row of a list, following Meta's `paging.next` up to `max` rows. */
export async function graphAll<T>(path: string, params: Params = {}, max = 1000): Promise<T[]> {
  const first = await graph<{ data?: T[]; paging?: { next?: string } }>(path, { params: { limit: 200, ...params } });
  const rows = [...(first.data ?? [])];
  let next = first.paging?.next;
  while (next && rows.length < max) {
    const page = await parse<{ data?: T[]; paging?: { next?: string } }>(await fetch(next, { signal: AbortSignal.timeout(30_000) }));
    rows.push(...(page.data ?? []));
    next = page.paging?.next;
  }
  return rows.slice(0, max);
}

/** "123" or "act_123" → "act_123". */
export const actId = (id: string) => (id.startsWith('act_') ? id : `act_${id}`);

// ── Connecting ─────────────────────────────────────────────────────────────

export const redirectUri = (origin: string) => `${origin.replace(/\/+$/, '')}/api/ads/callback`;

export function authorizeUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: META_APP_ID(),
    redirect_uri: redirectUri(origin),
    response_type: 'code',
    state,
  });
  // Facebook Login for Business prefers a configuration (config_id) to scopes; scopes still work for a person's token.
  if (LOGIN_CONFIG_ID()) { q.set('config_id', LOGIN_CONFIG_ID()); q.set('override_default_response_type', 'true'); }
  else { q.set('scope', SCOPES.join(',')); q.set('auth_type', 'rerequest'); }
  return `https://www.facebook.com/${GRAPH_VERSION()}/dialog/oauth?${q}`;
}

interface DebugToken {
  type?: string;
  user_id?: string;
  is_valid?: boolean;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
}

/** What Meta says about a token: whose, which permissions, until when. Needs the app secret. */
export async function inspectToken(token: string): Promise<DebugToken | null> {
  const secret = await appSecret();
  if (!secret || !META_APP_ID()) return null;
  const q = new URLSearchParams({ input_token: token, access_token: `${META_APP_ID()}|${secret}` });
  const d = await parse<{ data?: DebugToken }>(await fetch(`${GRAPH}/${GRAPH_VERSION()}/debug_token?${q}`, { signal: AbortSignal.timeout(10_000) }));
  return d.data ?? null;
}

const expiryOf = (d: DebugToken | null, fallbackSeconds?: number): string | null => {
  // expires_at 0 = never. Data access (90 days) lapses separately; whichever is first.
  const times = [d?.expires_at, d?.data_access_expires_at].filter((t): t is number => typeof t === 'number' && t > 0).map(t => t * 1000);
  if (times.length) return new Date(Math.min(...times)).toISOString();
  if (d && d.expires_at === 0) return null;
  return fallbackSeconds ? new Date(Date.now() + fallbackSeconds * 1000).toISOString() : null;
};

/** The code from Facebook → a long-lived token, checked and saved. */
export async function completeConnection(origin: string, code: string): Promise<AdsConnection> {
  const secret = await appSecret();
  if (!secret) throw new MetaAdsError('The Meta app secret is not set in this project yet (see Setup).', 503);
  const base = `${GRAPH}/${GRAPH_VERSION()}/oauth/access_token`;
  const short = await parse<{ access_token: string; expires_in?: number }>(await fetch(`${base}?${new URLSearchParams({
    client_id: META_APP_ID(), client_secret: secret, redirect_uri: redirectUri(origin), code,
  })}`, { signal: AbortSignal.timeout(15_000) }));
  let token = short.access_token;
  let expiresIn = short.expires_in;
  let info = await inspectToken(token).catch(() => null);
  const system = String(info?.type || '').toUpperCase().includes('SYSTEM');
  if (!system && info?.expires_at !== 0) {
    // A person's short token (an hour or two) → the 60-day one.
    const long = await parse<{ access_token: string; expires_in?: number }>(await fetch(`${base}?${new URLSearchParams({
      grant_type: 'fb_exchange_token', client_id: META_APP_ID(), client_secret: secret, fb_exchange_token: token,
    })}`, { signal: AbortSignal.timeout(15_000) }));
    token = long.access_token;
    expiresIn = long.expires_in ?? 60 * 86_400;
    info = await inspectToken(token).catch(() => info);
  }
  const me = await graph<{ id?: string; name?: string }>('me', { token, params: { fields: 'id,name' } }).catch(() => ({} as { id?: string; name?: string }));
  const conn: AdsConnection = {
    token,
    kind: system ? 'system' : 'user',
    userId: String(me.id || info?.user_id || ''),
    userName: String(me.name || (system ? 'System user' : '')),
    expiresAt: expiryOf(info, expiresIn),
    scopes: info?.scopes ?? [],
    connectedAt: new Date().toISOString(),
  };
  await saveConnection(conn);
  return conn;
}

/** The saved connection with Meta's current word on it (valid? permissions? expiry?). */
export async function checkConnection(): Promise<{ conn: AdsConnection; valid: boolean; scopes: string[]; expiresAt: string | null; error?: string } | null> {
  const conn = await loadConnection();
  if (!conn) return null;
  try {
    const info = await inspectToken(conn.token);
    if (!info) {
      // No app secret to ask with: try the token itself.
      await graph('me', { token: conn.token, params: { fields: 'id' } });
      return { conn, valid: true, scopes: conn.scopes, expiresAt: conn.expiresAt };
    }
    const expiresAt = info.is_valid ? expiryOf(info) : conn.expiresAt;
    return { conn, valid: !!info.is_valid, scopes: info.scopes ?? conn.scopes, expiresAt, error: info.is_valid ? undefined : 'Meta says this connection is no longer valid.' };
  } catch (e) {
    return { conn, valid: false, scopes: conn.scopes, expiresAt: conn.expiresAt, error: e instanceof Error ? e.message : String(e) };
  }
}
