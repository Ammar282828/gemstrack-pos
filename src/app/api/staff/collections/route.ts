/**
 * The shop floor's read path.
 *
 * Staff have no direct Firestore access at all (firestore.rules), so this is
 * how the client store fills itself for them. It runs with the Admin SDK,
 * reads only the collections on the staff list, and strips the cost-side
 * fields before anything leaves the server.
 *
 * Owner-gated as well as staff-gated: an owner hitting this gets the same
 * filtered payload, which keeps the endpoint honest — there is no shape of
 * request that returns more than a staff member is allowed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail, isStaffCollection, STAFF_COLLECTIONS } from '@/lib/roles';
import { staffViewAll } from '@/lib/staff-view';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = roleForEmail(email);
  if (role !== 'staff' && role !== 'owner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // One collection per call, so a slow collection cannot hold up the rest and
  // the client can keep its existing per-collection loading states.
  const name = req.nextUrl.searchParams.get('name') || '';
  if (!isStaffCollection(name)) {
    return NextResponse.json(
      { error: 'Not available', allowed: STAFF_COLLECTIONS },
      { status: 403 },
    );
  }

  try {
    const snap = await adminDb.collection(name).get();
    const docs = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    return NextResponse.json(
      { collection: name, docs: staffViewAll(name, docs) },
      // Never cached: an order taken thirty seconds ago has to be there.
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error(`[/api/staff/collections] ${name}`, e);
    return NextResponse.json({ error: 'Could not read' }, { status: 500 });
  }
}
