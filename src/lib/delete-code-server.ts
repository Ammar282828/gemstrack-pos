/**
 * The delete code, server side (owner, 2026-10-01: "add ability to delete invoices/advances/orders
 * or anything — just make it a verification thing to do that [code]").
 *
 * Every delete in the ERP asks for a four-digit code first (components/shared/delete-code.tsx).
 * The code is never in the repository (gemstrack-pos is public) nor in the browser: each house
 * keeps a salted hash in its own Firestore at `app_private/delete_code`, and only this server
 * compares. It is a deliberate-action check, not the database's boundary: an owner can write
 * Firestore directly, and the rules are what stand between a stranger and the data.
 *
 * Set or change it: scripts/set-delete-code.mjs <project> <code>.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { adminDb } from './firebase-admin';

const DOC = () => adminDb.collection('app_private').doc('delete_code');

export const hashDeleteCode = (code: string, salt: string) =>
  createHash('sha256').update(`erp-delete-code:${salt}:${code.trim()}`).digest('hex');

export const newDeleteCodeRecord = (code: string, setBy: string) => {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: hashDeleteCode(code, salt), setAt: new Date().toISOString(), setBy };
};

/** 'ok', 'wrong', or 'unset' when this house has no code yet. */
export async function checkDeleteCode(code: string): Promise<'ok' | 'wrong' | 'unset'> {
  const d = (await DOC().get()).data() as { salt?: string; hash?: string } | undefined;
  if (!d?.salt || !d.hash) return 'unset';
  if (!/^\d{4,8}$/.test(code.trim())) return 'wrong';
  const a = Buffer.from(hashDeleteCode(code, d.salt), 'hex'), b = Buffer.from(d.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'wrong';
}
