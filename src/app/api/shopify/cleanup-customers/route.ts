import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// Deletes Shopify-synced customers that have no usable identifying info:
// name is the generic fallback AND email is empty AND phone is empty
export async function POST() {
  try {
    const snap = await adminDb.collection('customers')
      .where('shopifyCustomerId', '!=', '')
      .get();

    const toDelete: string[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      const isGarbage =
        (!d.name || d.name === 'Shopify Customer') &&
        (!d.email || d.email === '') &&
        (!d.phone || d.phone === '');
      if (isGarbage) toDelete.push(doc.id);
    }

    // Firestore batches max 500 ops
    const batchSize = 500;
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = adminDb.batch();
      for (const id of toDelete.slice(i, i + batchSize)) {
        batch.delete(adminDb.collection('customers').doc(id));
      }
      await batch.commit();
    }

    return NextResponse.json({ deleted: toDelete.length, ids: toDelete });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
