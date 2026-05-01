import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { shopifyRequest, getShopifyCredentials, mapProductToShopify, findShopifyProductIdsBySku } from '../../_lib';

/**
 * Idempotent product push. Resolves the Shopify product in this order:
 *   1. Stored shopifyProductId on the POS doc.
 *   2. SKU lookup via GraphQL productVariants(query:"sku:X").
 *   3. None — create new.
 */
export async function POST(request: NextRequest) {
  try {
    const { sku } = await request.json();
    if (!sku) return NextResponse.json({ error: 'sku required' }, { status: 400 });

    if (sku.startsWith('SHOPIFY-PROD-')) {
      return NextResponse.json({ skipped: true, reason: 'shopify-originated' });
    }

    const { shop, token } = await getShopifyCredentials(adminDb);

    const productDoc = await adminDb.collection('products').doc(sku).get();
    if (!productDoc.exists) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    const product = productDoc.data()!;

    const payload = mapProductToShopify(product);
    let shopifyProductId: string | undefined = product.shopifyProductId;
    let shopifyVariantId: string | undefined = product.shopifyVariantId;

    // Verify the stored id still exists, else fall back.
    if (shopifyProductId) {
      try { await shopifyRequest(shop, token, 'GET', `/products/${shopifyProductId}.json`); }
      catch { shopifyProductId = undefined; shopifyVariantId = undefined; }
    }
    if (!shopifyProductId) {
      const found = await findShopifyProductIdsBySku(shop, token, sku);
      if (found) { shopifyProductId = found.productId; shopifyVariantId = found.variantId; }
    }

    if (shopifyProductId) {
      const updatePayload: any = JSON.parse(JSON.stringify(payload));
      updatePayload.product.id = Number(shopifyProductId);
      if (shopifyVariantId) updatePayload.product.variants[0].id = Number(shopifyVariantId);
      await shopifyRequest(shop, token, 'PUT', `/products/${shopifyProductId}.json`, updatePayload);
      if (
        String(product.shopifyProductId || '') !== String(shopifyProductId) ||
        String(product.shopifyVariantId || '') !== String(shopifyVariantId)
      ) {
        await adminDb.collection('products').doc(sku).update({ shopifyProductId, shopifyVariantId });
      }
    } else {
      const result = await shopifyRequest(shop, token, 'POST', '/products.json', payload);
      shopifyProductId = String(result.product.id);
      shopifyVariantId = String(result.product.variants[0]?.id || '');
      await adminDb.collection('products').doc(sku).update({ shopifyProductId, shopifyVariantId });
    }

    return NextResponse.json({ success: true, shopifyProductId, shopifyVariantId });
  } catch (e: any) {
    console.error('[shopify/push/product]', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
