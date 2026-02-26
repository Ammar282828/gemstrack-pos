import { NextRequest, NextResponse } from 'next/server';
import { validateWebhookHmac, firestoreSet, toFirestoreFields, mapInvoice } from '../../_lib';

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || '';

  if (!validateWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const order = JSON.parse(rawBody);
  const invoiceId = `SHOPIFY-${order.order_number}`;
  const invoice = mapInvoice(order);
  await firestoreSet('invoices', invoiceId, toFirestoreFields(invoice));

  // Also upsert the customer if present
  if (order.customer) {
    const { mapCustomer } = await import('../../_lib');
    const customerId = `shopify-${order.customer.id}`;
    await firestoreSet('customers', customerId, toFirestoreFields(mapCustomer(order.customer)));
  }

  return NextResponse.json({ ok: true });
}
