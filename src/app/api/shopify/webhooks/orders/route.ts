import { NextRequest, NextResponse } from 'next/server';
import { validateWebhookHmac, mapInvoice, mapCustomer } from '../../_lib';
import { adminDb } from '@/lib/firebase-admin';

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (SHOPIFY_API_SECRET) {
    const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || '';
    if (!validateWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const order = JSON.parse(rawBody);
  const invoiceId = `SHOPIFY-${order.order_number}`;

  await adminDb.collection('invoices').doc(invoiceId).set(mapInvoice(order), { merge: true });

  if (order.customer) {
    const customerId = `shopify-${order.customer.id}`;
    await adminDb.collection('customers').doc(customerId).set(mapCustomer(order.customer), { merge: true });
  }

  return NextResponse.json({ ok: true });
}
