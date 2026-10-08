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
import { roleForEmail } from '@/lib/roles';
import {
  STORE_BRAND, STORE_CONFIG, STORE_TAKEN_BY, STORE_PARTNERSHIP, STORE_WEBSITE_SELLING, STORE_INVOICE_BY_CUSTOMER,
  STORE_INVOICE_WHATSAPP_PDF, STORE_SIZE_TO_PROFILE,
} from '@/lib/store-config';
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
    ...(karigar ? { karigar: { id: karigar.karigarId, name: karigar.name } } : {}),
    house: { brand: STORE_BRAND, name: STORE_CONFIG.name, metal: STORE_CONFIG.defaultMetal },
    shop: {
      name: STORE_CONFIG.name,
      person: personFor(email) ?? null,
      takenBy: [...STORE_TAKEN_BY],
      expenseCategories: [...EXPENSE_CATEGORIES],
      partnership: STORE_PARTNERSHIP,
      websiteSelling: STORE_WEBSITE_SELLING,
      invoiceByCustomer: STORE_INVOICE_BY_CUSTOMER,
      invoiceWhatsappPdf: STORE_INVOICE_WHATSAPP_PDF,
      sizeToProfile: STORE_SIZE_TO_PROFILE,
    },
  });
}
