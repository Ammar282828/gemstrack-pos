/**
 * GET: who the signed-in person is to this house, for the native iPhone app (apps/iphone), which
 * cannot read the ERP's role lists (they are build-time settings of the web app): owner, staff,
 * marketing or a karigar, and which house this is.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveKarigar, verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { STORE_BRAND, STORE_CONFIG } from '@/lib/store-config';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const role = roleForEmail(email);
  const karigar = role === 'none' ? await resolveKarigar(req) : null;
  return NextResponse.json({
    email,
    role: karigar ? 'karigar' : role,
    ...(karigar ? { karigar: { id: karigar.karigarId, name: karigar.name } } : {}),
    house: { brand: STORE_BRAND, name: STORE_CONFIG.name, metal: STORE_CONFIG.defaultMetal },
  });
}
