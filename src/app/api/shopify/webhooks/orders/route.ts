import { NextRequest, NextResponse } from 'next/server';
import { getShopifyCredentials, webhookResourceId } from '../../_lib';
import { adminDb } from '@/lib/firebase-admin';
import { mirrorShopifyOrderById } from '../../_order-mirror';

/**
 * orders/create and orders/updated: what Shopify says happened to a web order since it was pulled
 * in — paid, shipped, cancelled — onto its invoice (app/api/shopify/_order-mirror.ts).
 *
 * The notice is only told which order; the order itself is read back from Shopify with the shop's
 * own token. So nothing in the body is trusted and no signing secret is needed: until 2026-10-06
 * every notice was refused for one, signed by the "HOM POS" app and checked against another app's
 * secret, and the ERP's web orders froze as they were pulled. Reading it back also means notices
 * arriving out of order, or twice (Mina's store sends each to two addresses), all end in Shopify's
 * latest word.
 */
export async function POST(request: NextRequest) {
  const orderId = webhookResourceId(await request.text());
  if (!orderId) return NextResponse.json({ ok: true, skipped: 'no-order-id' });

  let creds: { shop: string; token: string };
  try { creds = await getShopifyCredentials(adminDb); } catch { return NextResponse.json({ ok: true, skipped: 'not-connected' }); }

  try {
    const outcome = await mirrorShopifyOrderById(creds.shop, creds.token, orderId);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    // A failure answers 500, so Shopify sends it again later.
    console.error('[shopify/webhooks/orders]', orderId, (e as Error)?.message);
    return NextResponse.json({ error: 'mirror failed' }, { status: 500 });
  }
}
