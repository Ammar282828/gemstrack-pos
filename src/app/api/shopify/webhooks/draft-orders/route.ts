import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { validateWebhookHmac } from '../../_lib';
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

  const draftOrder = JSON.parse(rawBody);
  const draftOrderId = String(draftOrder.id);

  // When a draft order is completed (status = 'completed'), it becomes a real order.
  // The orders/create webhook will handle marking the POS invoice as paid.
  // Here we just update the checkout URL in case it changed.
  if (draftOrder.status === 'completed' && draftOrder.order_id) {
    // Find the POS invoice linked to this draft order
    const snap = await adminDb.collection('invoices')
      .where('shopifyDraftOrderId', '==', draftOrderId)
      .limit(1)
      .get();

    if (!snap.empty) {
      const invoiceDoc = snap.docs[0];
      const invoice = invoiceDoc.data();
      const grandTotal = invoice.grandTotal || 0;

      await invoiceDoc.ref.update({
        shopifyOrderId: String(draftOrder.order_id),
        amountPaid: grandTotal,
        balanceDue: 0,
        paymentHistory: admin.firestore.FieldValue.arrayUnion({
          amount: grandTotal - (invoice.amountPaid || 0),
          date: new Date().toISOString(),
          notes: `Paid via Shopify checkout`,
        }),
      });

      // Update hisaab — remove outstanding balance entries
      const hisaabSnap = await adminDb.collection('hisaab')
        .where('linkedInvoiceId', '==', invoiceDoc.id)
        .get();
      const batch = adminDb.batch();
      hisaabSnap.docs.forEach((d: any) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  return NextResponse.json({ ok: true });
}
