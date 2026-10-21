/**
 * AI keys (docs/features/ai-keys.md): what lets ChatGPT, Claude, Gemini or Cursor into this house's ERP,
 * over MCP (/api/agent/mcp) or the REST twin (/api/agent/v1/*). One key system for every outside agent,
 * the Ad studio's board agent included (its keys are keys with the `studio` scope; the old `tstudio_`
 * keys still work, board.ts).
 *
 *   tk_<house>_<id>_<secret>     the key, shown once. `house` is a hint (taheri, mina) so a key pasted
 *                                into the wrong ERP says so; `id` finds its record; `secret` is checked.
 *   app_private/ai_key__<id>     the record: label, scopes, who made it, when, optional expiry, last use,
 *                                calls, and the SHA-256 of the secret (and of any token an AI's connector
 *                                was given for it through the sign-in page, oauth.ts). Never the key.
 *
 * `app_private` is the Admin SDK's alone under the locked rules (firestore.rules), so not even an owner's
 * browser can read the hashes or forge a record — and while the rules are not locked (Taheri's, until the owner
 * publishes them) no key is honoured at all: rules-guard.ts asks Firestore as a stranger first. The secret is compared in constant time. A key is good
 * only while the person who made it still has the role it needs (an owner removed from the list takes
 * their keys with them). Server-only.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { roleForEmail } from '@/lib/roles';
import { STORE_BRAND } from '@/lib/store-config';
import { cleanScopes, type Scope } from './scopes';
import { keysAllowed } from './rules-guard';

const COL = 'app_private';
const PREFIX = 'ai_key__';
const KIND = 'ai_key';
/** At most this many keys a house (old ones are revoked by hand; the Studio's dialog makes them freely). */
export const MAX_KEYS = 40;
/** Tokens a key's connectors may hold at once (each sign-in through the connector page adds one). */
const MAX_TOKENS = 8;

export interface KeyRecord {
  kind: typeof KIND;
  id: string;
  label: string;
  scopes: Scope[];
  /** SHA-256 hex of the secret. */
  hash: string;
  /** The key's last four characters, to tell keys apart on screen. */
  tail: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  calls: number;
  /** Tokens given to an AI's connector through the sign-in page (oauth.ts), as hashes. */
  tokens?: { hash: string; at: string }[];
}

/** What the screens see: everything but the hashes. */
export type KeyInfo = Omit<KeyRecord, 'hash' | 'tokens' | 'kind'> & { connectors: number };

/** A checked key: who it acts as and what it may do. */
export interface AgentKey { id: string; label: string; scopes: Scope[]; email: string; role: ReturnType<typeof roleForEmail>; expiresAt: string | null }

export type KeyCheck = { ok: true; key: AgentKey } | { ok: false; reason: 'missing' | 'malformed' | 'house' | 'unknown' | 'expired' | 'orphaned' | 'paused'; message: string };

const now = () => new Date().toISOString();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ref = (id: string) => adminDb.collection(COL).doc(`${PREFIX}${id}`);

/** This house's word in its keys. */
export const houseHint = (): string => (STORE_BRAND === 'mina' ? 'mina' : 'taheri');

const KEY_RE = /^tk_([a-z]{2,12})_([a-f0-9]{16})_([A-Za-z0-9_-]{32,64})$/;

/** A key's parts, or null when it isn't one of ours in shape. */
export function parseKey(raw: string): { house: string; id: string; secret: string } | null {
  const m = KEY_RE.exec(raw.trim());
  return m ? { house: m[1], id: m[2], secret: m[3] } : null;
}

/** Equal hashes, compared in constant time (unequal lengths fail at once; a hash's length is no secret). */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

const info = (r: KeyRecord): KeyInfo => {
  const { hash: _h, tokens, kind: _k, ...rest } = r;
  return { ...rest, connectors: tokens?.length ?? 0 };
};

/** Which scopes the maker's role still allows: the books and posting for an owner, the Studio for marketing too. */
export function scopesFor(role: ReturnType<typeof roleForEmail>, scopes: readonly Scope[]): Scope[] {
  if (role === 'owner') return [...scopes];
  if (role === 'marketing') return scopes.filter(s => s === 'studio');
  return [];
}

export interface NewKey { label: string; scopes: unknown; by: string; expiresAt?: string | null }

/** A new key: answered once, whole; kept only as its hash. */
export async function createKey(p: NewKey): Promise<{ key: string; info: KeyInfo }> {
  const scopes = cleanScopes(p.scopes);
  if (!scopes.length) throw Object.assign(new Error('Tick at least one thing the AI may do.'), { status: 400 });
  let expiresAt: string | null = null;
  if (p.expiresAt) {
    const t = Date.parse(p.expiresAt);
    if (!Number.isFinite(t) || t <= Date.now()) throw Object.assign(new Error('The expiry must be a date in the future.'), { status: 400 });
    expiresAt = new Date(t).toISOString();
  }
  const id = randomBytes(8).toString('hex');
  const secret = randomBytes(30).toString('base64url');
  const key = `tk_${houseHint()}_${id}_${secret}`;
  const record: KeyRecord = {
    kind: KIND, id, label: p.label.trim().replace(/\s+/g, ' ').slice(0, 60) || 'AI', scopes,
    hash: sha256(secret), tail: key.slice(-4), createdBy: p.by, createdAt: now(), expiresAt, lastUsedAt: null, calls: 0,
  };
  const held = await adminDb.collection(COL).where('kind', '==', KIND).get();
  if (held.size >= MAX_KEYS) throw Object.assign(new Error(`This shop already has ${MAX_KEYS} keys. Revoke one you no longer use first.`), { status: 409 });
  await ref(id).set(record);
  return { key, info: info(record) };
}

export async function listKeys(): Promise<KeyInfo[]> {
  const snap = await adminDb.collection(COL).where('kind', '==', KIND).get();
  return snap.docs.map(d => info(d.data() as KeyRecord)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getKey(id: string): Promise<KeyInfo | null> {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  const s = await ref(id).get();
  return s.exists ? info(s.data() as KeyRecord) : null;
}

/** Revoked is gone: the record is deleted, so the key (and every connector's token for it) stops at once. */
export async function revokeKey(id: string): Promise<boolean> {
  if (!/^[a-f0-9]{16}$/.test(id)) return false;
  const r = ref(id);
  if (!(await r.get()).exists) return false;
  await r.delete();
  return true;
}

/** Is this the key (or a connector's token for it), still good, for someone who still may? */
export async function checkKey(raw: string | null | undefined, at = new Date()): Promise<KeyCheck> {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, reason: 'missing', message: 'An AI key is needed: Settings → Connect an AI makes one.' };
  const parts = text.length <= 120 ? parseKey(text) : null;
  if (!parts) return { ok: false, reason: 'malformed', message: 'That is not an ERP AI key (they start tk_).' };
  if (parts.house !== houseHint()) return { ok: false, reason: 'house', message: `That key is for ${parts.house}’s ERP, not this one.` };
  // While anyone could write app_private, a matching record proves nothing: every key waits for the locked rules.
  const rules = await keysAllowed();
  if (!rules.ok) return { ok: false, reason: 'paused', message: rules.message };
  const s = await ref(parts.id).get();
  const r = s.exists ? (s.data() as KeyRecord) : null;
  const h = sha256(parts.secret);
  const matches = !!r && (sameHash(h, r.hash) || (r.tokens ?? []).some(t => sameHash(h, t.hash)));
  if (!r || !matches) return { ok: false, reason: 'unknown', message: 'That key is not known here — it may have been revoked. Make a new one in Settings → Connect an AI.' };
  if (r.expiresAt && Date.parse(r.expiresAt) <= at.getTime()) return { ok: false, reason: 'expired', message: `That key expired on ${r.expiresAt.slice(0, 10)}. Make a new one in Settings → Connect an AI.` };
  const role = roleForEmail(r.createdBy);
  const scopes = scopesFor(role, r.scopes);
  if (!scopes.length) return { ok: false, reason: 'orphaned', message: 'The person who made that key no longer has access, so the key stopped.' };
  return { ok: true, key: { id: r.id, label: r.label, scopes, email: r.createdBy, role, expiresAt: r.expiresAt } };
}

/** One more call on the key, and when (not waited on by callers that answer first). */
export async function noteUse(id: string): Promise<void> {
  await ref(id).update({ lastUsedAt: now(), calls: FieldValue.increment(1) });
}

/** A token for an AI's connector, standing for this key (oauth.ts); revoking the key stops it too. */
export async function addToken(id: string): Promise<string> {
  const secret = randomBytes(30).toString('base64url');
  const r = ref(id);
  await adminDb.runTransaction(async tx => {
    const s = await tx.get(r);
    if (!s.exists) throw Object.assign(new Error('That key has been revoked.'), { status: 400 });
    const tokens = [...(((s.data() as KeyRecord).tokens) ?? []), { hash: sha256(secret), at: now() }].slice(-MAX_TOKENS);
    tx.update(r, { tokens });
  });
  return `tk_${houseHint()}_${id}_${secret}`;
}
