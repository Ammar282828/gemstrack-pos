/**
 * The signed-in customer's own record.
 *
 *   GET  /api/public/me            → { profile, favourites, orders }
 *   PUT  /api/public/me            { profile?, favourites? } → the same
 *
 * Bearer: a Firebase ID token from the site's Google sign-in, verified
 * server-side. Without one: 401. Called from taheri.shop, so CORS as the
 * other public routes.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, preflight } from '@/lib/website/cors';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';
import { identityFromRequest, loadCustomer, ordersFor, saveCustomer } from '@/lib/website/customers';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

async function view(id: NonNullable<Awaited<ReturnType<typeof identityFromRequest>>>, record: Awaited<ReturnType<typeof loadCustomer>>) {
  const orders = await ordersFor(id.uid);
  return { uid: id.uid, email: record.email, displayName: record.displayName, photoURL: record.photoURL, profile: record.profile, favourites: record.favourites, orders };
}

export async function GET(req: NextRequest) {
  const id = await identityFromRequest(req);
  if (!id) return json(req, { error: 'Sign in to see your account.' }, { status: 401 });
  const limit = await rateLimit('me', id.uid, 120, 60);
  if (!limit.ok) return json(req, { error: 'Too many requests.' }, { status: 429 });
  return json(req, await view(id, await loadCustomer(id)));
}

const Put = z.object({
  profile: z.object({
    name: z.string().max(120).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().max(200).optional(),
    address: z.string().max(400).optional(),
    city: z.string().max(80).optional(),
  }).optional(),
  favourites: z.array(z.string().max(300)).max(500).optional(),
});

export async function PUT(req: NextRequest) {
  const id = await identityFromRequest(req);
  if (!id) return json(req, { error: 'Sign in to save to your account.' }, { status: 401 });
  const limit = await rateLimit('me-write', id.uid, 60, 60);
  if (!limit.ok) return json(req, { error: 'Too many changes; try again in a minute.' }, { status: 429 });
  const parsed = Put.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: parsed.error.issues[0]?.message || 'Bad request' }, { status: 400 });
  const record = await saveCustomer(id, parsed.data);
  return json(req, await view(id, record));
}
