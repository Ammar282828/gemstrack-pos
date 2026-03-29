import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

/**
 * Migrates existing CSV-imported Shopify invoices from INV-XXXXXX IDs
 * to SHOPIFY-{order_number} IDs so they match the sync format.
 *
 * POST /api/shopify/migrate-ids
 */
export async function POST() {
  try {
    const snap = await adminDb.collection('invoices').where('source', '==', 'shopify_import').get();

    let migrated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const orderName: string = data.shopifyOrderName || '';

      // shopifyOrderName is like "#1234" — extract the number
      const match = orderName.match(/#?(\d+)/);
      if (!match) { skipped++; continue; }

      const newId = `SHOPIFY-${match[1]}`;

      // Skip if already in the right format
      if (docSnap.id === newId) { skipped++; continue; }

      // Skip if target doc already exists (don't overwrite a real API-synced one)
      const targetSnap = await adminDb.collection('invoices').doc(newId).get();
      if (targetSnap.exists) { skipped++; continue; }

      try {
        const batch = adminDb.batch();
        batch.set(adminDb.collection('invoices').doc(newId), {
          ...data,
          id: newId,
          source: 'shopify', // normalise source now that it has the correct ID
        });
        batch.delete(adminDb.collection('invoices').doc(docSnap.id));
        await batch.commit();
        migrated++;
      } catch (e: any) {
        errors.push(`${docSnap.id} → ${newId}: ${e.message}`);
      }
    }

    return NextResponse.json({ success: true, migrated, skipped, errors });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
