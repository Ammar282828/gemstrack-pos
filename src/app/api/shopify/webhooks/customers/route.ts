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

  // Echo prevention: customers we just pushed carry tag `pos-pushed` plus a
  // `pos-customer-{id}` handle. Don't write a phantom shopify-* mirror —
  // update the actual POS customer doc instead.
  const tags = (customer.tags || '').split(',').map((t: string) => t.trim()).filter(Boolean);
  const posTag = tags.find((t: string) => t.startsWith('pos-customer-'));
  const isPosPushed = tags.includes('pos-pushed') || !!posTag;

  if (isPosPushed && posTag) {
    const posCustomerId = posTag.replace(/^pos-customer-/, '');
    if (posCustomerId) {
      await adminDb.collection('customers').doc(posCustomerId).set(
        { shopifyCustomerId: String(customer.id) },
        { merge: true },
      );
    }
    return NextResponse.json({ ok: true, skipped: 'pos-echo' });
  }

  if (!isPosPushed) {
    const customerId = `shopify-${customer.id}`;
    await adminDb.collection('customers').doc(customerId).set(mapCustomer(customer), { merge: true });
  }

  return NextResponse.json({ ok: true });
}
