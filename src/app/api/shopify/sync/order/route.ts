import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  buildShopifyDraftOrderPayload,
  findShopifyDraftOrderIdByTag,
  getShopifyCredentials,
  shopifyRequest,
} from '../../_lib';

/**
 * Idempotent Shopify sync for a single POS order (in-progress, not yet
 * finalized into an invoice). Uses Shopify Draft Orders, which are fully
 * editable until they're either deleted or completed into a real order.
 *
 * Body: { orderId: string, shopifyDraftOrderId?: string, action?: 'upsert' | 'cancel' }
 *
 * Stable handle: every draft order created by POS is tagged
 *   `pos-order-{orderId}`. Searches use that tag so we can re-find the
 *   draft even if the locally-stored shopifyDraftOrderId was lost.
 *
 * Lifecycle: when the POS order is finalized into an invoice, the caller
 * should fire `cancel` here (to remove the draft) and then upsert the
 * invoice via /api/shopify/sync/invoice. Drafts and orders are separate
 * Shopify resources — there is no in-place transition.
 */
export async function POST(request: NextRequest) {
  try {
    const { orderId, shopifyDraftOrderId, action = 'upsert' } = await request.json();
    if (!orderId && !shopifyDraftOrderId) {
      return NextResponse.json({ error: 'orderId or shopifyDraftOrderId required' }, { status: 400 });
    }
    const { shop, token } = await getShopifyCredentials(adminDb);

    if (action === 'upsert') {
      if (!orderId) return NextResponse.json({ error: 'upsert requires orderId' }, { status: 400 });
      return await handleDraftUpsert(orderId, shop, token);
    }
    if (action === 'cancel') return await handleDraftCancel(orderId, shopifyDraftOrderId, shop, token);
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    console.error('[shopify/sync/order]', e?.message || e);
    return NextResponse.json({ error: e?.message || 'sync failed' }, { status: 500 });
  }
}

// ─── upsert ───────────────────────────────────────────────────────────────

async function handleDraftUpsert(orderId: string, shop: string, token: string) {
  const orderDoc = await adminDb.collection('orders').doc(orderId).get();
  if (!orderDoc.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const order: any = orderDoc.data();

  // If already invoiced, the draft has served its purpose — let the invoice
  // sync handle it. We also clean up any stray draft just in case.
  if (order.invoiceId) {
    await cancelDraftIfPresent(orderDoc.ref, order, shop, token);
    return NextResponse.json({ skipped: true, reason: 'order-invoiced' });
  }

  // Refunded / cancelled orders shouldn't have live drafts
  if (order.status === 'Refunded' || order.status === 'Cancelled') {
    await cancelDraftIfPresent(orderDoc.ref, order, shop, token);
    return NextResponse.json({ skipped: true, reason: `order-${String(order.status).toLowerCase()}` });
  }

  // No items? Nothing to push.
  if (!order.items || !order.items.length) {
    return NextResponse.json({ skipped: true, reason: 'no-items' });
  }

  // Resolve customer
  let shopifyCustomerId: string | undefined;
  if (order.customerId) {
    const cust = await adminDb.collection('customers').doc(order.customerId).get();
    const id = cust.exists ? (cust.data() as any)?.shopifyCustomerId : undefined;
    if (id) shopifyCustomerId = String(id);
  }

  // Resolve existing draft
  let existingId: string | null = order.shopifyDraftOrderId ? String(order.shopifyDraftOrderId) : null;
  let existingDraft: any = null;
  if (existingId) {
    try {
      const r = await shopifyRequest(shop, token, 'GET', `/draft_orders/${existingId}.json`);
      existingDraft = r?.draft_order || null;
      if (existingDraft && existingDraft.status === 'completed') {
        // Already turned into a real order — don't touch it.
        existingDraft = null;
        existingId = null;
      }
    } catch {
      existingDraft = null;
      existingId = null;
    }
  }
  if (!existingDraft) {
    existingId = await findShopifyDraftOrderIdByTag(shop, token, `pos-order-${orderId}`);
    if (existingId) {
      const r = await shopifyRequest(shop, token, 'GET', `/draft_orders/${existingId}.json`);
      existingDraft = r?.draft_order || null;
    }
  }

  const payload = buildShopifyDraftOrderPayload({ ...order, id: orderId }, { shopifyCustomerId });

  if (!existingDraft) {
    const result = await shopifyRequest(shop, token, 'POST', '/draft_orders.json', payload);
    const newId = String(result.draft_order.id);
    await orderDoc.ref.update({
      shopifyDraftOrderId: newId,
      shopifyDraftOrderName: result.draft_order.name,
    });
    return NextResponse.json({
      success: true,
      action: 'created',
      shopifyDraftOrderId: newId,
      shopifyDraftOrderName: result.draft_order.name,
    });
  }

  // Update the draft in place. Drafts are fully editable.
  const updateBody = { draft_order: { id: Number(existingId), ...payload.draft_order } };
  await shopifyRequest(shop, token, 'PUT', `/draft_orders/${existingId}.json`, updateBody);

  // Make sure the order doc points at the right draft id
  if (String(order.shopifyDraftOrderId || '') !== String(existingId)) {
    await orderDoc.ref.update({ shopifyDraftOrderId: String(existingId) });
  }

  return NextResponse.json({ success: true, action: 'updated', shopifyDraftOrderId: String(existingId) });
}

async function cancelDraftIfPresent(
  orderRef: FirebaseFirestore.DocumentReference,
  order: any,
  shop: string,
  token: string,
) {
  let id: string | null = order.shopifyDraftOrderId ? String(order.shopifyDraftOrderId) : null;
  if (!id) id = await findShopifyDraftOrderIdByTag(shop, token, `pos-order-${order.id || orderRef.id}`);
  if (!id) return;
  try { await shopifyRequest(shop, token, 'DELETE', `/draft_orders/${id}.json`); } catch { /* swallow */ }
  await orderRef.update({
    shopifyDraftOrderId: (await import('firebase-admin/firestore')).FieldValue.delete(),
  }).catch(() => {});
}

// ─── cancel ───────────────────────────────────────────────────────────────

async function handleDraftCancel(
  orderId: string | undefined,
  explicitDraftId: string | undefined,
  shop: string,
  token: string,
) {
  let targetId: string | null = explicitDraftId || null;
  if (!targetId && orderId) {
    const orderDoc = await adminDb.collection('orders').doc(orderId).get();
    if (orderDoc.exists) {
      const id = (orderDoc.data() as any)?.shopifyDraftOrderId;
      if (id) targetId = String(id);
    }
  }
  if (!targetId && orderId) targetId = await findShopifyDraftOrderIdByTag(shop, token, `pos-order-${orderId}`);
  if (!targetId) return NextResponse.json({ skipped: true, reason: 'no-draft-found' });

  try {
    await shopifyRequest(shop, token, 'DELETE', `/draft_orders/${targetId}.json`);
    return NextResponse.json({ success: true, action: 'deleted', shopifyDraftOrderId: targetId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'delete failed' }, { status: 500 });
  }
}
