/**
 * The server half of lib/shopify-karigar.ts: which karigar the house's Shopify orders go to (read from the karigar book,
 * kept five minutes), and the once-only pass that gives him the unassigned pieces of the Shopify orders already open.
 * Server-only.
 */
import { adminDb } from '@/lib/firebase-admin';
import { statusFromPieces } from '@/lib/order-stage';
import { matchKarigar, shopifyKarigarName, type KarigarRow } from '@/lib/shopify-karigar';

let cached: { at: number; name: string; id: string | null } | null = null;

/** The karigar id for the house's Shopify orders, or null (none named, none found, or the name is not one person's). */
export async function shopifyKarigarId(): Promise<string | null> {
  const name = shopifyKarigarName();
  if (!name) return null;
  if (cached && cached.name === name && Date.now() - cached.at < 5 * 60 * 1000) return cached.id;
  const snap = await adminDb.collection('karigars').get();
  const rows: KarigarRow[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<KarigarRow, 'id'>) }));
  const hit = matchKarigar(rows, name);
  if (!hit) console.warn(`[shopify-karigar] no single karigar named "${name}"; Shopify orders stay unassigned`);
  cached = { at: Date.now(), name, id: hit?.id ?? null };
  return cached.id;
}

const OPEN = new Set(['Pending', 'In Progress']);
const unassigned = (p: { karigarId?: string }) => !p.karigarId || p.karigarId === 'none';

/**
 * Once per karigar named: every open, uninvoiced Shopify order's unassigned pieces to him (and Pending → In Progress when
 * that leaves none unassigned, as giving the pieces out by hand does). Remembered in `app_settings/shopify_karigar`, so a
 * piece moved to someone else afterwards is never taken back.
 */
export async function shopifyKarigarBackfill(): Promise<{ orders: string[] } | null> {
  const name = shopifyKarigarName();
  if (!name) return null;
  const marker = adminDb.collection('app_settings').doc('shopify_karigar');
  const done = (await marker.get()).data() as { name?: string } | undefined;
  if (done?.name === name) return null;
  const karigarId = await shopifyKarigarId();
  if (!karigarId) return null;
  const snap = await adminDb.collection('orders').where('source', '==', 'shopify').get();
  const changed: string[] = [];
  for (const d of snap.docs) {
    const o = d.data() as { status?: string; invoiceId?: string; items?: { karigarId?: string; isCompleted?: boolean }[] };
    if (!OPEN.has(String(o.status)) || o.invoiceId || !Array.isArray(o.items) || !o.items.some(unassigned)) continue;
    await adminDb.runTransaction(async tx => {
      const fresh = (await tx.get(d.ref)).data() as typeof o | undefined;
      if (!fresh || !OPEN.has(String(fresh.status)) || fresh.invoiceId || !Array.isArray(fresh.items)) return;
      const items = fresh.items.map(p => (unassigned(p) ? { ...p, karigarId } : p));
      const status = statusFromPieces(String(fresh.status), items as never);
      tx.set(d.ref, { items, ...(status && { status }) }, { merge: true });
      changed.push(d.id);
    });
  }
  await marker.set({ name, karigarId, backfilledAt: new Date().toISOString(), orders: changed }, { merge: true });
  if (changed.length) console.log(`[shopify-karigar] gave ${changed.length} open Shopify orders to ${name}: ${changed.join(', ')}`);
  return { orders: changed };
}
