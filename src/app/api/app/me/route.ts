/**
 * GET: who the signed-in person is to this house, for the native iPhone app (apps/iphone), which
 * cannot read the ERP's role lists (they are build-time settings of the web app): owner, staff,
 * marketing or a karigar, and which house this is.
 *
 * `shop` carries the house's own settings the screens follow, as the web reads them from its build
 * (lib/store-config.ts): the counter names and the one this account is, the expense categories, the
 * partnership, whether the website sells, how an invoice is named. None is secret (the web ships them
 * to every browser); the app has no other way to know them, and guessing them from the books was wrong.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveKarigar, verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail, seesMoney, alsoMarketing } from '@/lib/roles';
import { STORE_BRAND, STORE_CONFIG, STORE_TAKEN_BY, STORE_SHOPIFY_ANALYTICS } from '@/lib/store-config';
import { shopFlags } from '@/lib/app-shop';
import { paymentLinksOn } from '@/lib/safepay';
import { safepaySecretSet } from '@/lib/safepay-fees-server';
import { tcsStatus } from '@/lib/tcs-payments-server';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import { personFor } from '@/lib/people';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const role = roleForEmail(email);
  const karigar = role === 'none' ? await resolveKarigar(req) : null;
  return NextResponse.json({
    email,
    role: karigar ? 'karigar' : role,
    // What the app hides (decisions: Staff see no money): amounts outside the bill in hand are the owners'; a staff member
    // on the marketing list too also gets the marketing places, without spend (lib/roles.ts).
    seesMoney: seesMoney(email),
    alsoMarketing: alsoMarketing(email),
    ...(karigar ? { karigar: { id: karigar.karigarId, name: karigar.name } } : {}),
    house: { brand: STORE_BRAND, name: STORE_CONFIG.name, metal: STORE_CONFIG.defaultMetal },
    shop: {
      name: STORE_CONFIG.name,
      person: personFor(email) ?? null,
      takenBy: [...STORE_TAKEN_BY],
      expenseCategories: [...EXPENSE_CATEGORIES],
      ...shopFlags(),
      // Safepay payment links on invoices and orders (lib/safepay.ts), as /api/app/business says.
      paymentLinks: await paymentLinksOn(),
      // Safepay's fees and tax recorded monthly as expenses (lib/safepay-fees.ts): whether an owner has given the secret key.
      safepayFees: role === 'owner' ? await safepaySecretSet().catch(() => false) : false,
      // TCS's own account (lib/tcs-payments.ts): connected, and what it has paid out; owners only.
      ...(role === 'owner' ? { tcs: await tcsStatus().catch(() => ({ connected: false })) } : {}),
      // The house whose website is Shopify: the phones show Shopify's own analytics in Website (decision "Shopify analytics").
      shopifyAnalytics: STORE_SHOPIFY_ANALYTICS,
    },
  });
}
