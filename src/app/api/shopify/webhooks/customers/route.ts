import { NextRequest, NextResponse } from 'next/server';
import { validateWebhookHmac, firestoreSet, toFirestoreFields, mapCustomer } from '../../_lib';

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || '';

  if (!validateWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const customer = JSON.parse(rawBody);
  const customerId = `shopify-${customer.id}`;
  await firestoreSet('customers', customerId, toFirestoreFields(mapCustomer(customer)));

  return NextResponse.json({ ok: true });
}
