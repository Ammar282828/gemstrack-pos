import { NextRequest, NextResponse } from 'next/server';
import { APP_URL, SHOPIFY_API_VERSION } from '../_lib';
import { adminDb } from '@/lib/firebase-admin';

const WEBHOOK_TOPICS = [
  { topic: 'orders/create', address: `${APP_URL}/api/shopify/webhooks/orders` },
  { topic: 'orders/updated', address: `${APP_URL}/api/shopify/webhooks/orders` },
  { topic: 'customers/create', address: `${APP_URL}/api/shopify/webhooks/customers` },
  { topic: 'customers/update', address: `${APP_URL}/api/shopify/webhooks/customers` },
  { topic: 'products/create', address: `${APP_URL}/api/shopify/webhooks/products` },
  { topic: 'products/update', address: `${APP_URL}/api/shopify/webhooks/products` },
  { topic: 'draft_orders/update', address: `${APP_URL}/api/shopify/webhooks/draft-orders` },
];

async function getExistingWebhooks(shop: string, token: string) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
    headers: { 'X-Shopify-Access-Token': token },
  });
  const data = await res.json();
  return (data.webhooks || []) as { id: number; topic: string; address: string }[];
}

async function registerWebhook(shop: string, token: string, topic: string, address: string) {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
  });
  return res.json();
}

export async function POST(request: NextRequest) {
  try {
    // Allow passing shop/token directly (used from callback) or read from Firestore
    let shop: string;
    let token: string;

    const body = await request.json().catch(() => ({}));
    if (body.shop && body.token) {
      shop = body.shop;
      token = body.token;
    } else {
      shop = process.env.SHOPIFY_STORE_DOMAIN ?? '';
      token = process.env.SHOPIFY_ACCESS_TOKEN ?? '';
      if (!shop || !token) {
        const settingsSnap = await adminDb.collection('app_settings').doc('global').get();
        const d = settingsSnap.data() || {};
        shop = d.shopifyStoreDomain;
        token = d.shopifyAccessToken;
      }
    }

    if (!shop || !token) {
      return NextResponse.json({ error: 'Shopify not connected.' }, { status: 400 });
    }

    const existing = await getExistingWebhooks(shop, token);
    const registered: string[] = [];
    const skipped: string[] = [];

    for (const { topic, address } of WEBHOOK_TOPICS) {
      const alreadyExists = existing.some(w => w.topic === topic && w.address === address);
      if (alreadyExists) {
        skipped.push(topic);
      } else {
        await registerWebhook(shop, token, topic, address);
        registered.push(topic);
      }
    }

    return NextResponse.json({ success: true, registered, skipped });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
