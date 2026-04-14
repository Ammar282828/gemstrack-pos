import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { validateWebhookHmac, mapInvoice, mapCustomer } from '../../_lib';
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

  const order = JSON.parse(rawBody);
  const invoiceId = `SHOPIFY-${order.order_number}`;

  // Check if this order originated from a POS draft order (payment link flow)
  const posInvoiceMatch = order.note?.match(/POS Invoice (INV-\d+)/);
  if (posInvoiceMatch && (order.financial_status === 'paid' || order.financial_status === 'partially_paid')) {
    const posInvoiceId = posInvoiceMatch[1];
    const posInvoiceDoc = await adminDb.collection('invoices').doc(posInvoiceId).get();
    if (posInvoiceDoc.exists) {
      const data = posInvoiceDoc.data()!;
      const grandTotal = data.grandTotal || 0;
      const alreadyPaid = data.amountPaid || 0;
      const newPayment = grandTotal - alreadyPaid;

      if (newPayment > 0) {
        await posInvoiceDoc.ref.update({
          amountPaid: grandTotal,
          balanceDue: 0,
          shopifyOrderId: String(order.id),
          shopifyOrderNumber: order.order_number,
          paymentHistory: admin.firestore.FieldValue.arrayUnion({
            amount: newPayment,
            date: new Date().toISOString(),
            notes: `Paid via Shopify checkout (Order #${order.order_number})`,
          }),
        });

        // Clean up hisaab outstanding balance entries
        const hisaabSnap = await adminDb.collection('hisaab')
          .where('linkedInvoiceId', '==', posInvoiceId)
          .get();
        const batch = adminDb.batch();
        hisaabSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
  }

  // Standard Shopify order → invoice sync (for non-POS orders)
  await adminDb.collection('invoices').doc(invoiceId).set(mapInvoice(order), { merge: true });

  if (order.customer) {
    const customerId = `shopify-${order.customer.id}`;
    await adminDb.collection('customers').doc(customerId).set(mapCustomer(order.customer), { merge: true });
  }

  return NextResponse.json({ ok: true });
}
