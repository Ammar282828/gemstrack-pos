import { NextRequest, NextResponse } from 'next/server';
import { erpUserOrCron } from '@/lib/erp-gate';
import { ensureShopifyWebhooks } from '@/lib/shopify-webhooks';
import { adminDb } from '@/lib/firebase-admin';

// The notices themselves are lib/shopify-webhooks.ts (orders, and each parcel's TCS update); the tick keeps them registered daily.

export async function POST(request: NextRequest) {
  // Signed-in owner or staff, or the scheduler: this route changes the shop's Shopify store.
  const denied = await erpUserOrCron(request);
  if (denied) return denied;
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

    return NextResponse.json({ success: true, ...(await ensureShopifyWebhooks(shop, token)) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
