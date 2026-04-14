import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { shopifyRequest, getShopifyCredentials, mapProductToShopify } from '../../_lib';

export async function POST(request: NextRequest) {
  try {
    const { sku } = await request.json();
    if (!sku) return NextResponse.json({ error: 'sku required' }, { status: 400 });

    const { shop, token } = await getShopifyCredentials(adminDb);

    const productDoc = await adminDb.collection('products').doc(sku).get();
    if (!productDoc.exists) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const product = productDoc.data()!;

    // Skip Shopify-originated products
    if (sku.startsWith('SHOPIFY-PROD-')) {
      return NextResponse.json({ skipped: true, reason: 'shopify-originated' });
    }

    const payload = mapProductToShopify(product);
    let shopifyProductId = product.shopifyProductId;
    let shopifyVariantId = product.shopifyVariantId;

    if (shopifyProductId) {
      // Update existing — update the product and its first variant
      const updatePayload = { ...payload };
      if (shopifyVariantId) {
        updatePayload.product.variants[0].id = Number(shopifyVariantId);
      }
      await shopifyRequest(shop, token, 'PUT', `/products/${shopifyProductId}.json`, updatePayload);
    } else {
      // Create new Shopify product
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
