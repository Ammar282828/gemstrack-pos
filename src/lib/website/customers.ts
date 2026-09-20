/**
 * A customer's account on taheri.shop — one record per Google identity.
 *
 * What it holds is what follows a person between devices: the favourites
 * they marked, the details checkout asks for, and which orders are theirs.
 * The browser never touches Firestore; every read and write comes through
 * /api/public/me with the customer's Firebase ID token, verified here with
 * the admin SDK. Firestore rules can stay closed to the world.
 *
 * Identity is the POS's own Firebase project: a customer signing in on the
 * site is a user in that pool with no role in the book — roles.ts answers
 * 'none' for them — so nothing here overlaps with staff sign-in.
 */

import { adminAuth, adminDb } from '@/lib/firebase-admin';
import type { NextRequest } from 'next/server';

const COLLECTION = 'website_customers';
const MAX_FAVOURITES = 500;

export interface CustomerProfile {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
}

export interface CustomerRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  profile: CustomerProfile;
  favourites: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Identity { uid: string; email: string; name: string; photo: string }

/** The verified Google identity behind a Bearer token, or null. */
export async function identityFromRequest(req: NextRequest): Promise<Identity | null> {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const d = await adminAuth.verifyIdToken(m[1]);
    if (!d.uid) return null;
    return { uid: d.uid, email: String(d.email || '').toLowerCase(), name: String(d.name || ''), photo: String(d.picture || '') };
  } catch {
    return null;
  }
}

const blank = (id: Identity): CustomerRecord => ({
  uid: id.uid,
  email: id.email,
  displayName: id.name,
  photoURL: id.photo,
  profile: { name: id.name, phone: '', email: id.email, address: '', city: 'Karachi' },
  favourites: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export async function loadCustomer(id: Identity): Promise<CustomerRecord> {
  const snap = await adminDb.collection(COLLECTION).doc(id.uid).get();
  if (!snap.exists) return blank(id);
  const d = snap.data() as Partial<CustomerRecord>;
  const b = blank(id);
  return {
    ...b,
    ...d,
    uid: id.uid,
    profile: { ...b.profile, ...(d.profile || {}) },
    favourites: Array.isArray(d.favourites) ? d.favourites.filter(k => typeof k === 'string').slice(0, MAX_FAVOURITES) : [],
  };
}

/** A piece key: Category/Collection/file, no dot-segments, sane length. */
export const isPieceKey = (k: unknown): k is string =>
  typeof k === 'string' && k.length <= 300 && k.split('/').length === 3 && !k.split('/').some(s => !s || s === '.' || s === '..');

export async function saveCustomer(id: Identity, patch: { profile?: Partial<CustomerProfile>; favourites?: string[] }): Promise<CustomerRecord> {
  const current = await loadCustomer(id);
  const next: CustomerRecord = {
    ...current,
    email: id.email || current.email,
    displayName: id.name || current.displayName,
    photoURL: id.photo || current.photoURL,
    profile: { ...current.profile, ...(patch.profile || {}) },
    favourites: patch.favourites ? [...new Set(patch.favourites.filter(isPieceKey))].slice(0, MAX_FAVOURITES) : current.favourites,
    updatedAt: new Date().toISOString(),
  };
  await adminDb.collection(COLLECTION).doc(id.uid).set(next);
  return next;
}

/** The customer's website orders, newest first, in the shape their order page shows. */
export async function ordersFor(uid: string): Promise<{ id: string; token: string; placedAt: string; status: string; paymentStatus: string; grandTotal: number; items: { description: string; image: string }[] }[]> {
  const origin = (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
  const snap = await adminDb.collection('orders').where('website.customerUid', '==', uid).limit(50).get();
  const out = snap.docs.map(doc => {
    const o = doc.data() as Record<string, unknown>;
    const w = (o.website || {}) as { token?: string; placedAt?: string; paymentStatus?: string; pieces?: string[] };
    const items = ((o.items as { description: string }[]) || []).map((it, i) => ({
      description: it.description,
      image: w.pieces?.[i] ? `${origin}/catalog-thumb/${encodeURI(w.pieces[i])}` : '',
    }));
    return { id: doc.id, token: w.token || '', placedAt: w.placedAt || '', status: String(o.status || 'Pending'), paymentStatus: String(w.paymentStatus || ''), grandTotal: Number(o.grandTotal) || 0, items };
  });
  return out.sort((a, b) => b.placedAt.localeCompare(a.placedAt));
}
