import { NextRequest, NextResponse } from 'next/server';
import { validateWebhookHmac, mapCustomer } from '../../_lib';
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

  const customer = JSON.parse(rawBody);
  const customerId = `shopify-${customer.id}`;
  await adminDb.collection('customers').doc(customerId).set(mapCustomer(customer), { merge: true });

  return NextResponse.json({ ok: true });
}
