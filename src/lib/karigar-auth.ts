/**
 * Server-side identity for the karigar portal.
 *
 * Karigars are deliberately NOT granted direct Firestore access (see
 * firestore.rules — they are not on the owner allowlist, so every client-side
 * read is denied). Instead the portal calls /api/karigar/* and this module
 * resolves their identity from a verified Firebase ID token.
 *
 * That matters because Firestore rules are per-document, not per-field: letting
 * a karigar read an `orders` doc to see their item would also hand them the
 * customer's name, phone and the full pricing of the order. Filtering here, on
 * the server, means they only ever receive the fields they need.
 */

import type { NextRequest } from 'next/server';
import { adminAuth, adminDb } from './firebase-admin';
import { STORE_CONFIG } from './store-config';

export interface KarigarIdentity {
  karigarId: string;
  name: string;
  email: string;
}

function normalise(email: string | undefined | null): string {
  return String(email || '').trim().toLowerCase();
}

export function isOwnerEmail(email: string | undefined | null): boolean {
  const e = normalise(email);
  return !!e && STORE_CONFIG.allowedEmails.map(a => a.trim().toLowerCase()).includes(e);
}

/** Verify the `Authorization: Bearer <idToken>` header. Returns the email, or null. */
export async function verifyRequestEmail(req: NextRequest): Promise<string | null> {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    // Only trust Google-verified addresses — an unverified email could be spoofed
    // on a self-managed provider.
    if (decoded.email_verified === false) return null;
    return normalise(decoded.email);
  } catch {
    return null;
  }
}

/**
 * Resolve the karigar this request belongs to. Returns null when the token is
 * missing/invalid or no karigar has that email on file.
 */
export async function resolveKarigar(req: NextRequest): Promise<KarigarIdentity | null> {
  const email = await verifyRequestEmail(req);
  if (!email) return null;

  const snap = await adminDb.collection('karigars').where('email', '==', email).limit(1).get();
  if (snap.empty) {
    // Fall back to a case-insensitive scan — emails may have been entered with
    // different casing before normalisation was enforced.
    const all = await adminDb.collection('karigars').get();
    const hit = all.docs.find(d => normalise(d.data()?.email) === email);
    if (!hit) return null;
    return { karigarId: hit.id, name: hit.data()?.name || 'Karigar', email };
  }

  const doc = snap.docs[0];
  return { karigarId: doc.id, name: doc.data()?.name || 'Karigar', email };
}
