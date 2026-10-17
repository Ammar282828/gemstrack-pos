/**
 * What push keeps in Firestore: the Apple key (sealed, lib/push/apns-key.ts) and the phones
 * that asked for notifications (`push_devices`, one document per phone, named by a hash of its
 * token). Everything here is read and written by the server alone.
 *
 * Server-only.
 */

import crypto from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { openKey, sealKey, type ApnsKey, type SealedKey } from './apns-key';

export const PUSH_KINDS = ['sales', 'payments', 'orders', 'karigar'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

export interface PushDevice {
  token: string;
  /** Absent (older documents) means 'ios'. */
  platform?: 'ios' | 'android';
  bundleId: string;
  email: string;
  /** Kinds this phone has switched off (Settings → Notifications on the phone). */
  off: PushKind[];
  /** "iPhone" and the like, for the list in Settings. */
  label: string;
  createdAt: string;
  updatedAt: string;
}

const KEY_DOC = () => adminDb.collection('app_private').doc('apns');
const DEVICES = () => adminDb.collection('push_devices');
export const deviceId = (token: string) => crypto.createHash('sha256').update(token).digest('hex').slice(0, 40);

const secret = () => {
  const s = process.env.CRON_SECRET;
  if (!s) throw new Error('CRON_SECRET is not set here, so the push key cannot be kept.');
  return s;
};

let keyCache: { key: ApnsKey | null; at: number } | null = null;

/** A found key is kept 10 minutes; a missing one only 30 s, so a key just uploaded on another instance works at once. */
export const KEY_TTL_MS = 10 * 60_000;
export const NO_KEY_TTL_MS = 30_000;
export const keyCacheFresh = (c: { key: ApnsKey | null; at: number } | null, now = Date.now()) =>
  !!c && now - c.at < (c.key ? KEY_TTL_MS : NO_KEY_TTL_MS);

export async function saveApnsKey(k: ApnsKey, by: string): Promise<void> {
  await KEY_DOC().set(sealKey(k, secret(), by));
  keyCache = null;
}

/** The key, or null when none is set or it was sealed under another CRON_SECRET. */
export async function loadApnsKey(): Promise<ApnsKey | null> {
  if (keyCache && keyCacheFresh(keyCache)) return keyCache.key;
  const snap = await KEY_DOC().get();
  const key = snap.exists ? openKey(snap.data() as SealedKey, secret()) : null;
  keyCache = { key, at: Date.now() };
  return key;
}

export async function apnsKeyStatus(): Promise<{ set: boolean; readable: boolean; keyId?: string; teamId?: string; setAt?: string; setBy?: string }> {
  const snap = await KEY_DOC().get();
  if (!snap.exists) return { set: false, readable: false };
  const s = snap.data() as SealedKey;
  return { set: true, readable: !!openKey(s, secret()), keyId: s.keyId, teamId: s.teamId, setAt: s.setAt, setBy: s.setBy };
}

export async function saveDevice(d: { token: string; platform?: 'ios' | 'android'; bundleId: string; email: string; label?: string; off?: PushKind[] }): Promise<PushDevice> {
  const ref = DEVICES().doc(deviceId(d.token));
  const now = new Date().toISOString();
  const prev = (await ref.get()).data() as PushDevice | undefined;
  const next: PushDevice = {
    token: d.token,
    platform: d.platform ?? prev?.platform ?? 'ios',
    bundleId: d.bundleId,
    email: d.email,
    label: (d.label ?? prev?.label ?? ((d.platform ?? prev?.platform) === 'android' ? 'Android' : 'iPhone')).slice(0, 60),
    off: (d.off ?? prev?.off ?? []).filter((k): k is PushKind => (PUSH_KINDS as readonly string[]).includes(k)),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await ref.set(next);
  return next;
}

export async function readDevice(token: string): Promise<PushDevice | null> {
  const snap = await DEVICES().doc(deviceId(token)).get();
  return snap.exists ? (snap.data() as PushDevice) : null;
}

export async function forgetDevices(tokens: string[]): Promise<void> {
  await Promise.all(tokens.map((t) => DEVICES().doc(deviceId(t)).delete().catch(() => undefined)));
}

/** The last registration failure a phone reported (no token in it): one document per person and app. */
export interface PushFailure { bundleId: string; label: string; error: string; email: string; at: string }

export const failureId = (email: string, bundleId: string) =>
  `${crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 20)}_${bundleId}`.slice(0, 150);

export async function saveFailure(f: PushFailure): Promise<void> {
  await adminDb.collection('push_devices_failed').doc(failureId(f.email, f.bundleId)).set(f, { merge: true });
}

export async function allDevices(): Promise<PushDevice[]> {
  return (await DEVICES().get()).docs.map((d) => d.data() as PushDevice).filter((d) => d.token && d.bundleId);
}
