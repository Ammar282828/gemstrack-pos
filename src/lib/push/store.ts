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

export async function saveApnsKey(k: ApnsKey, by: string): Promise<void> {
  await KEY_DOC().set(sealKey(k, secret(), by));
  keyCache = null;
}

/** The key, or null when none is set or it was sealed under another CRON_SECRET. */
export async function loadApnsKey(): Promise<ApnsKey | null> {
  if (keyCache && Date.now() - keyCache.at < 10 * 60_000) return keyCache.key;
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

export async function saveDevice(d: { token: string; bundleId: string; email: string; label?: string; off?: PushKind[] }): Promise<PushDevice> {
  const ref = DEVICES().doc(deviceId(d.token));
  const now = new Date().toISOString();
  const prev = (await ref.get()).data() as PushDevice | undefined;
  const next: PushDevice = {
    token: d.token,
    bundleId: d.bundleId,
    email: d.email,
    label: (d.label ?? prev?.label ?? 'iPhone').slice(0, 60),
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

export async function allDevices(): Promise<PushDevice[]> {
  return (await DEVICES().get()).docs.map((d) => d.data() as PushDevice).filter((d) => d.token && d.bundleId);
}
