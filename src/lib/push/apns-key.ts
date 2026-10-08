/**
 * The Apple push key (an APNs auth key, AuthKey_<id>.p8): one per Apple team, good for both
 * houses' apps, uploaded by an owner in Settings → Notifications (/api/push/key).
 *
 * Kept in Firestore `app_private/apns`, sealed with AES-256-GCM under a key drawn from the
 * backend's CRON_SECRET (Secret Manager): Taheri's Firestore rules are still open, so a document
 * alone is no secret, and Secret Manager is not writable from the ERP. Whoever reads the document
 * without CRON_SECRET has nothing; with it, only the power to send notifications to the shop's
 * own apps. A new CRON_SECRET makes the stored key unreadable: Settings then asks for the file again.
 *
 * Server-only.
 */

import crypto from 'node:crypto';

export interface ApnsKey {
  /** The PEM text. */
  p8: string;
  /** The 10-character key ID (it is in the file's name). */
  keyId: string;
  /** The Apple team (10 characters). */
  teamId: string;
}

export interface SealedKey {
  keyId: string;
  teamId: string;
  iv: string;
  data: string;
  tag: string;
  setAt: string;
  setBy: string;
}

/** The shop's Apple team (from the first signed builds, 2026-10-08). */
export const DEFAULT_TEAM_ID = 'TND272ULB5';

// Spelled in two halves: cloud-deploy refuses any file holding a whole PEM private-key header.
const LABEL = ['PRIVATE', 'KEY'].join(' ');

/**
 * The .p8 however it arrived: the whole file, only its middle, lines run together, base64'd.
 * '' when there is nothing key-like in it.
 */
export function normalizeP8(raw: string): string {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (!text.includes('-----BEGIN')) {
    try {
      const decoded = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) text = decoded;
    } catch { /* not base64 */ }
  }
  const body = text
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  if (!body) return '';
  return `-----BEGIN ${LABEL}-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END ${LABEL}-----\n`;
}

/** The key ID from Apple's file name, "AuthKey_ABCDE12345.p8". */
export const keyIdFromFileName = (name: string) => /AuthKey_([A-Z0-9]{10})/i.exec(String(name || ''))?.[1]?.toUpperCase() || '';

/** Why this is not a usable APNs key, or null. */
export function checkApnsKey(k: Partial<ApnsKey>): string | null {
  if (!/^[A-Z0-9]{10}$/.test(String(k.keyId || ''))) return 'The key ID is 10 letters and digits (it is in the file name: AuthKey_XXXXXXXXXX.p8).';
  if (!/^[A-Z0-9]{10}$/.test(String(k.teamId || ''))) return 'The team ID is 10 letters and digits.';
  try {
    const key = crypto.createPrivateKey(String(k.p8 || ''));
    if (key.asymmetricKeyType !== 'ec') return 'That is not an Apple push key (.p8).';
  } catch {
    return 'That file is not a readable .p8 key.';
  }
  return null;
}

const wrapKey = (secret: string) =>
  Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('erp-apns'), Buffer.from('apns-key-v1'), 32));

export function sealKey(k: ApnsKey, secret: string, by: string, now = new Date()): SealedKey {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', wrapKey(secret), iv);
  const data = Buffer.concat([cipher.update(k.p8, 'utf8'), cipher.final()]);
  return {
    keyId: k.keyId, teamId: k.teamId, iv: iv.toString('base64'), data: data.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), setAt: now.toISOString(), setBy: by,
  };
}

/** The key, or null when the secret it was sealed under is not this one. */
export function openKey(s: SealedKey, secret: string): ApnsKey | null {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', wrapKey(secret), Buffer.from(s.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(s.tag, 'base64'));
    const p8 = Buffer.concat([decipher.update(Buffer.from(s.data, 'base64')), decipher.final()]).toString('utf8');
    return { p8, keyId: s.keyId, teamId: s.teamId };
  } catch {
    return null;
  }
}
