import { NextRequest, NextResponse } from 'next/server';
import { validateWebhookHmac, mapProduct } from '../../_lib';
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

  const product = JSON.parse(rawBody);
  for (const variant of (product.variants || [])) {
    const sku = variant.sku || `SHOPIFY-PROD-${variant.id}`;
    await adminDb.collection('products').doc(sku).set(mapProduct(product, variant), { merge: true });
  }

  return NextResponse.json({ ok: true });
}
