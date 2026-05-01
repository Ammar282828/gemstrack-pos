import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  buildShopifyOrderPayload,
  findShopifyOrderIdByTag,
  getShopifyCredentials,
  shopifyRequest,
} from '../../_lib';

/**
 * Idempotent Shopify sync for a single POS invoice.
 *
 * Body: { invoiceId: string, action?: 'upsert' | 'cancel' | 'refund' }
 *
 * Stable handle: every Shopify order created by POS gets tagged
 *   `pos-inv-{invoiceId}`. Searches use that tag so we can re-find the order
 *   even if the locally-stored shopifyOrderId was lost (e.g. after an edit
 *   that deleted-and-recreated the invoice doc).
 *
 * Echo prevention: invoices whose id starts with `SHOPIFY-` or whose `source`
 * contains `shopify` are never pushed.
 */
export async function POST(request: NextRequest) {
  try {
    const { invoiceId, shopifyOrderId, action = 'upsert', amount, reason } = await request.json();
    if (!invoiceId && !shopifyOrderId) {
      return NextResponse.json({ error: 'invoiceId or shopifyOrderId required' }, { status: 400 });
    }
    if (invoiceId && invoiceId.startsWith('SHOPIFY-')) {
      return NextResponse.json({ skipped: true, reason: 'shopify-originated' });
    }

    const { shop, token } = await getShopifyCredentials(adminDb);

    if (action === 'upsert') {
      if (!invoiceId) return NextResponse.json({ error: 'upsert requires invoiceId' }, { status: 400 });
      return await handleUpsert(invoiceId, shop, token);
    }
    if (action === 'cancel') return await handleCancel(invoiceId, shopifyOrderId, shop, token);
    if (action === 'refund') return await handleRefund(invoiceId, shop, token, shopifyOrderId, amount, reason);
    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    console.error('[shopify/sync/invoice]', e?.message || e);
    return NextResponse.json({ error: e?.message || 'sync failed' }, { status: 500 });
  }
}

// ─── upsert ───────────────────────────────────────────────────────────────

async function handleUpsert(invoiceId: string, shop: string, token: string) {
  const invDoc = await adminDb.collection('invoices').doc(invoiceId).get();
  if (!invDoc.exists) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  const inv: any = invDoc.data();

  if (inv.source && String(inv.source).includes('shopify')) {
    return NextResponse.json({ skipped: true, reason: 'shopify-originated' });
  }

  // Refunded invoices should never push live; refund flow handles them
  if (inv.status === 'Refunded') {
    return NextResponse.json({ skipped: true, reason: 'refunded' });
  }

  // Resolve the Shopify customer id (so the order is attached to a customer).
  let shopifyCustomerId: string | undefined;
  if (inv.customerId) {
    const cust = await adminDb.collection('customers').doc(inv.customerId).get();
    const id = cust.exists ? (cust.data() as any)?.shopifyCustomerId : undefined;
    if (id) shopifyCustomerId = String(id);
  }

  // Resolve existing Shopify order: prefer stored id, else find by tag.
  let existingId: string | null = inv.shopifyOrderId ? String(inv.shopifyOrderId) : null;
  let existingOrder: any = null;
  if (existingId) {
    try {
      const r = await shopifyRequest(shop, token, 'GET', `/orders/${existingId}.json`);
      existingOrder = r?.order || null;
    } catch {
      existingOrder = null;
      existingId = null;
    }
  }
  if (!existingOrder) {
    existingId = await findShopifyOrderIdByTag(shop, token, `pos-inv-${invoiceId}`);
    if (existingId) {
      const r = await shopifyRequest(shop, token, 'GET', `/orders/${existingId}.json`);
      existingOrder = r?.order || null;
    }
  }

  // Treat cancelled-and-locked orders as gone (we'll create a new one).
  if (existingOrder && existingOrder.cancelled_at) {
    existingOrder = null;
    existingId = null;
  }

  if (!existingOrder) {
    return await createNewOrder(invDoc.ref, inv, invoiceId, shop, token, shopifyCustomerId);
  }

  // Decide: can we keep the existing order, or do we need to recreate?
  // Shopify orders are immutable in line_items / total once created. We can only
  // update tags/note/customer in place. If items or grand total differ, the only
  // path is cancel + recreate.
  const needsRecreate = !lineItemsAndTotalMatch(existingOrder, inv);

  if (needsRecreate) {
    await safeRemoveShopifyOrder(shop, token, existingId!);
    return await createNewOrder(invDoc.ref, inv, invoiceId, shop, token, shopifyCustomerId);
  }

  // Items + total match. Reconcile payment + light fields only.
  await reconcilePayment(shop, token, existingOrder, inv);
  await updateLightFields(shop, token, existingId!, invoiceId, inv);

  // Make sure invoice points to the right Shopify order
  if (String(inv.shopifyOrderId || '') !== String(existingId)) {
    await invDoc.ref.update({
      shopifyOrderId: String(existingId),
      shopifyOrderNumber: existingOrder.order_number,
    });
  }

  return NextResponse.json({
    success: true,
    action: 'reconciled',
    shopifyOrderId: String(existingId),
    shopifyOrderNumber: existingOrder.order_number,
  });
}

async function createNewOrder(
  invRef: FirebaseFirestore.DocumentReference,
  inv: any,
  invoiceId: string,
  shop: string,
  token: string,
  shopifyCustomerId?: string,
) {
  const lineItems = (inv.items || []).filter((it: any) => (it?.itemTotal ?? 0) > 0);
  if (!lineItems.length) {
    return NextResponse.json({ skipped: true, reason: 'no-items' });
  }

  const payload = buildShopifyOrderPayload({ ...inv, id: invoiceId }, { shopifyCustomerId });
  const result = await shopifyRequest(shop, token, 'POST', '/orders.json', payload);
  const newId = String(result.order.id);
  const newNum = result.order.order_number;

  // If invoice was paid in POS, mark it paid in Shopify by adding sale transactions.
  await reconcilePayment(shop, token, result.order, inv);

  await invRef.update({ shopifyOrderId: newId, shopifyOrderNumber: newNum });
  return NextResponse.json({
    success: true,
    action: 'created',
    shopifyOrderId: newId,
    shopifyOrderNumber: newNum,
  });
}

function lineItemsAndTotalMatch(shopOrder: any, inv: any): boolean {
  const shopTotal = Math.round(parseFloat(shopOrder.total_price || '0') * 100);
  const invTotal = Math.round((inv.grandTotal || 0) * 100);
  if (shopTotal !== invTotal) return false;
  const shopItems = (shopOrder.line_items || []).map((li: any) => `${li.sku || ''}|${li.title}|${li.quantity}|${parseFloat(li.price)}`).sort();
  const invItems = (inv.items || []).map((it: any) => `${it.sku || ''}|${it.name || ''}|${it.quantity || 1}|${((it.itemTotal || 0) / (it.quantity || 1))}`).sort();
  if (shopItems.length !== invItems.length) return false;
  for (let i = 0; i < shopItems.length; i++) if (shopItems[i] !== invItems[i]) return false;
  return true;
}

async function reconcilePayment(shop: string, token: string, shopOrder: any, inv: any) {
  const orderId = String(shopOrder.id);
  const tx = await shopifyRequest(shop, token, 'GET', `/orders/${orderId}/transactions.json`);
  const sumSuccessful = (tx?.transactions || [])
    .filter((t: any) => t.status === 'success')
    .reduce((acc: number, t: any) => {
      const sign = (t.kind === 'sale' || t.kind === 'capture') ? 1 : (t.kind === 'refund' ? -1 : 0);
      return acc + sign * parseFloat(t.amount || '0');
    }, 0);
  const posPaid = Number(inv.amountPaid || 0);
  const delta = posPaid - sumSuccessful;
  if (Math.abs(delta) < 0.01) return;
  if (delta > 0) {
    await shopifyRequest(shop, token, 'POST', `/orders/${orderId}/transactions.json`, {
      transaction: {
        kind: 'sale',
        status: 'success',
        amount: delta.toFixed(2),
        currency: shopOrder.currency,
        gateway: 'manual',
        source: 'external',
      },
    });
  }
  // delta < 0 → POS paid less than Shopify recorded. Treated as a partial refund.
  if (delta < 0) {
    await issueRefund(shop, token, orderId, Math.abs(delta));
  }
}

async function updateLightFields(shop: string, token: string, orderId: string, invoiceId: string, inv: any) {
  const tags = ['pos-import', `pos-inv-${invoiceId}`];
  if (inv.sourceOrderId) tags.push(`pos-order-${inv.sourceOrderId}`);
  await shopifyRequest(shop, token, 'PUT', `/orders/${orderId}.json`, {
    order: {
      id: Number(orderId),
      tags: tags.join(','),
      note: `POS Invoice ${invoiceId}`,
    },
  });
}

// ─── cancel ───────────────────────────────────────────────────────────────

async function handleCancel(invoiceId: string | undefined, explicitShopifyOrderId: string | undefined, shop: string, token: string) {
  // Resolve target: explicit shopifyOrderId > invoice doc field > tag search.
  let targetId: string | null = explicitShopifyOrderId || null;
  if (!targetId && invoiceId) {
    const invDoc = await adminDb.collection('invoices').doc(invoiceId).get();
    targetId = invDoc.exists
      ? (invDoc.data() as any)?.shopifyOrderId ? String((invDoc.data() as any).shopifyOrderId) : null
      : null;
  }
  if (!targetId && invoiceId) targetId = await findShopifyOrderIdByTag(shop, token, `pos-inv-${invoiceId}`);
  if (!targetId) return NextResponse.json({ skipped: true, reason: 'no-shopify-order-found' });

  const removed = await safeRemoveShopifyOrder(shop, token, targetId);
  return NextResponse.json({ success: true, action: removed, shopifyOrderId: targetId });
}

/**
 * Try DELETE first (fully removes the order); fall back to cancel if DELETE is
 * rejected (Shopify rejects DELETE on orders with successful transactions).
 */
async function safeRemoveShopifyOrder(shop: string, token: string, orderId: string): Promise<'deleted' | 'cancelled' | 'noop'> {
  try {
    await shopifyRequest(shop, token, 'DELETE', `/orders/${orderId}.json`);
    return 'deleted';
  } catch (e: any) {
    if (!String(e?.message || '').match(/4\d\d/)) throw e;
  }
  try {
    await shopifyRequest(shop, token, 'POST', `/orders/${orderId}/cancel.json`, {});
    return 'cancelled';
  } catch (e: any) {
    if (String(e?.message || '').includes('already been cancelled')) return 'noop';
    throw e;
  }
}

// ─── refund ───────────────────────────────────────────────────────────────

async function handleRefund(
  invoiceId: string | undefined,
  shop: string,
  token: string,
  explicitShopifyOrderId?: string,
  partialAmount?: number,
  reason?: string,
) {
  let targetId: string | null = explicitShopifyOrderId || null;
  if (!targetId && invoiceId) {
    const invDoc = await adminDb.collection('invoices').doc(invoiceId).get();
    targetId = invDoc.exists
      ? (invDoc.data() as any)?.shopifyOrderId ? String((invDoc.data() as any).shopifyOrderId) : null
      : null;
  }
  if (!targetId && invoiceId) targetId = await findShopifyOrderIdByTag(shop, token, `pos-inv-${invoiceId}`);
  if (!targetId) return NextResponse.json({ skipped: true, reason: 'no-shopify-order-found' });

  // Determine refund amount: explicit partial, else full order total, capped
  // by the remaining (non-refunded) amount on the Shopify order.
  const r = await shopifyRequest(shop, token, 'GET', `/orders/${targetId}.json`);
  const order = r?.order;
  const orderTotal = parseFloat(order?.total_price || '0');
  const alreadyRefunded = (order?.refunds || [])
    .flatMap((rf: any) => rf.transactions || [])
    .filter((t: any) => t.kind === 'refund' && t.status === 'success')
    .reduce((s: number, t: any) => s + parseFloat(t.amount || '0'), 0);
  const remaining = Math.max(0, orderTotal - alreadyRefunded);
  const requested = partialAmount && partialAmount > 0 ? partialAmount : orderTotal;
  const refundAmount = Math.min(requested, remaining);

  if (refundAmount <= 0) {
    return NextResponse.json({ success: true, action: 'noop', reason: 'already-fully-refunded', shopifyOrderId: targetId });
  }
  await issueRefund(shop, token, targetId, refundAmount, reason);
  return NextResponse.json({
    success: true,
    action: refundAmount < orderTotal ? 'partially-refunded' : 'refunded',
    shopifyOrderId: targetId,
    amount: refundAmount,
  });
}

async function issueRefund(shop: string, token: string, orderId: string, amount: number, note?: string) {
  if (amount <= 0) return;
  // Use Shopify's calculate-then-create flow so the refund references real
  // transactions rather than failing on a missing parent_id.
  const calc = await shopifyRequest(shop, token, 'POST', `/orders/${orderId}/refunds/calculate.json`, {
    refund: {
      shipping: { full_refund: false },
      refund_line_items: [],
    },
  });
  const txTemplate = (calc?.refund?.transactions || []).map((t: any) => ({
    parent_id: t.parent_id,
    amount: amount.toFixed(2),
    kind: 'refund',
    gateway: t.gateway,
  }));
  if (!txTemplate.length) {
    // No transactions to refund (order was unpaid). Just cancel it.
    await safeRemoveShopifyOrder(shop, token, orderId);
    return;
  }
  await shopifyRequest(shop, token, 'POST', `/orders/${orderId}/refunds.json`, {
    refund: {
      notify: false,
      note: note || 'POS refund',
      shipping: { full_refund: false },
      refund_line_items: [],
      transactions: txTemplate,
    },
  });
}
