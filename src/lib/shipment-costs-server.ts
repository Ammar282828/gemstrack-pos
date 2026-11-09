/**
 * Every TCS parcel's full cost, stored and linked (owner, 2026-11-09). Server only; the reading is lib/shipment-costs.ts.
 *
 *   shipment_costs/<cn>   the parcel's costs by part, its order, the cash collected and received
 *   orders|invoices .shippingCost   a slice of it (never a money total of the sale), for the order page
 *   tcs_meta/cost-shape   the keys (no values) of the first reply of each kind, to fix the mapping once TCS is live
 *   tcs_meta/costs-backfill   where the backfill is (OCI windows back to 2024-01-01; COD per parcel), see syncTcsPayments
 *   tcs_meta/costs-summary    the year's count, cost and tax for Settings → TCS
 *
 * Imports nothing from lib/tcs-payments-server.ts (it calls this) or lib/tcs-cod-server.ts (loaded on demand).
 */
import { adminDb } from '@/lib/firebase-admin';
import { parcelOf } from '@/lib/tcs-payments';
import { replyShape } from '@/lib/tcs-cod';
import {
  costOf, leafRows, orderIdCandidates, rowFor, sameShippingCost, shipmentCost, shippingCostOf,
  type Costs, type ShipmentCost, type ShippingCost,
} from '@/lib/shipment-costs';

type Obj = Record<string, unknown>;
const COSTS = () => adminDb.collection('shipment_costs');
const META = (id: string) => adminDb.collection('tcs_meta').doc(id);

interface Linked { col: 'orders' | 'invoices'; id: string; shippingCost?: Partial<ShippingCost>; invoiceId?: string; date?: string }
/** consignment number → the orders and invoices that carry it. */
export type CnIndex = Map<string, Linked[]>;

/** Every order and invoice with a TCS number. */
export async function cnIndex(): Promise<CnIndex> {
  const idx: CnIndex = new Map();
  for (const col of ['orders', 'invoices'] as const) {
    const snap = await adminDb.collection(col).where('tcsConsignmentNo', '>', '').select('tcsConsignmentNo', 'shippingCost', 'invoiceId', 'createdAt', 'shopifyDeliveryAt').get();
    for (const d of snap.docs) {
      const x = d.data() as { tcsConsignmentNo?: string; shippingCost?: Partial<ShippingCost>; invoiceId?: string; createdAt?: string; shopifyDeliveryAt?: string };
      const cn = String(x.tcsConsignmentNo || '').trim();
      if (!cn) continue;
      const list = idx.get(cn) ?? [];
      list.push({ col, id: d.id, shippingCost: x.shippingCost, invoiceId: x.invoiceId, date: typeof x.createdAt === 'string' ? x.createdAt.slice(0, 10) : undefined });
      idx.set(cn, list);
    }
  }
  return idx;
}

/** Log a reply's outline (keys and kinds, never values) once per kind. */
export async function logShape(kind: 'oci' | 'cod' | 'invoice', reply: unknown, now: Date): Promise<void> {
  try {
    const ref = META('cost-shape');
    if ((await ref.get()).data()?.[kind]) return;
    const shape = JSON.stringify(replyShape(reply));
    console.info(`[tcs-costs] first ${kind} reply shape:`, shape);
    await ref.set({ [kind]: { at: now.toISOString(), shape } }, { merge: true });
  } catch { /* a log, never in the way */ }
}

const exists = new Map<string, boolean>();
async function orderExists(id: string): Promise<boolean> {
  if (!exists.has(id)) exists.set(id, (await adminDb.collection('orders').doc(id).get()).exists);
  return exists.get(id)!;
}

/** Write the costs and put their slice on each linked order and invoice. Returns how many orders/invoices were written. */
async function store(costs: ShipmentCost[], idx: CnIndex, orderNos: Map<string, string>): Promise<number> {
  let linked = 0;
  exists.clear();
  const ops: Array<(b: FirebaseFirestore.WriteBatch) => void> = [];
  for (const c of costs) {
    let links = idx.get(c.cn) ?? [];
    if (!links.length) {
      for (const id of orderIdCandidates(orderNos.get(c.cn) || '')) if (await orderExists(id)) { links = [{ col: 'orders', id }]; break; }
    }
    const order = links.find(l => l.col === 'orders');
    const doc: ShipmentCost = { ...c, ...(order ? { orderId: order.id } : {}) };
    ops.push(b => b.set(COSTS().doc(c.cn), doc));
    if (c.empty) continue;
    const slice = shippingCostOf(doc);
    const targets = [...links];
    // An order's invoice carries the cost too, even when it has no number of its own.
    if (order?.invoiceId && !targets.some(l => l.col === 'invoices' && l.id === order.invoiceId)) targets.push({ col: 'invoices', id: order.invoiceId });
    for (const l of targets) {
      if (sameShippingCost(l.shippingCost, slice)) continue;
      linked += 1;
      ops.push(b => b.set(adminDb.collection(l.col).doc(l.id), { shippingCost: slice }, { merge: true }));
    }
  }
  for (let i = 0; i < ops.length; i += 400) {
    const b = adminDb.batch();
    for (const op of ops.slice(i, i + 400)) op(b);
    await b.commit();
  }
  return linked;
}

/** OCI Payment/detail rows (raw, as TCS sent them): costed, stored, linked. */
export async function recordOciRows(rows: Obj[], idx: CnIndex, now: Date): Promise<{ costed: number; linked: number }> {
  if (!rows.length) return { costed: 0, linked: 0 };
  await logShape('oci', rows[0], now);
  const costs: ShipmentCost[] = [];
  const orderNos = new Map<string, string>();
  for (const row of rows) {
    const p = parcelOf(row);
    if (!p) continue;
    costs.push(shipmentCost(p.cn, costOf(row), { bookedOn: p.bookedOn, city: p.city, source: 'tcs-oci', paid: p.paid }, now));
    if (p.orderNo) orderNos.set(p.cn, p.orderNo);
  }
  return { costed: costs.length, linked: await store(costs, idx, orderNos) };
}

/** A payment-details reply (and its payment invoice's line) as costs; empty when TCS has nothing for the parcel yet. */
export function costsFromCod(detail: unknown, invoice: unknown, cn: string): Costs {
  const a = costOf(rowFor(detail, cn) ?? {});
  const row = invoice ? rowFor(invoice, cn) : null;
  const b = row ? costOf(row) : null;
  // The invoice line is the settled figure: it wins when it has more.
  return b && b.total > a.total ? { ...a, ...b, codCollected: b.codCollected ?? a.codCollected, amountPaid: b.amountPaid ?? a.amountPaid } : a;
}

export interface CodFetch { details(cn: string): Promise<unknown | null>; invoice(no: string): Promise<unknown | null> }

/**
 * COD payment-details for every order/invoice number that has no cost yet (and, after 3 days, the ones TCS had nothing for),
 * at most `cap` a run. `remaining` is how many have never been tried. Five errors in a row stop the run (not subscribed yet).
 */
export async function backfillCod(idx: CnIndex, fetcher: CodFetch, cap: number, now: Date): Promise<{ costed: number; remaining: number; error?: string }> {
  const cns = [...idx.keys()];
  const fresh: string[] = [], stale: string[] = [];
  for (let i = 0; i < cns.length; i += 300) {
    const part = cns.slice(i, i + 300);
    const snaps = await adminDb.getAll(...part.map(cn => COSTS().doc(cn)));
    snaps.forEach((s, j) => {
      if (!s.exists) fresh.push(part[j]);
      else { const d = s.data() as ShipmentCost; if (d.empty && d.source === 'tcs-cod' && now.getTime() - Date.parse(d.updatedAt) > 3 * 86400_000) stale.push(part[j]); }
    });
  }
  const todo = [...fresh, ...stale].slice(0, cap);
  const invoices = new Map<string, unknown | null>();
  const costs: ShipmentCost[] = [];
  let errors = 0, error: string | undefined;
  for (const cn of todo) {
    try {
      const detail = await fetcher.details(cn);
      errors = 0;
      if (detail) await logShape('cod', detail, now);
      let invoice: unknown | null = null;
      const no = detail ? leafRows(detail).flatMap(r => Object.entries(r)).find(([k, v]) => /invoice/i.test(k) && String(v ?? '').trim())?.[1] : undefined;
      if (no) {
        const key = String(no).trim();
        if (!invoices.has(key)) invoices.set(key, await fetcher.invoice(key).catch(() => null));
        invoice = invoices.get(key) ?? null;
        if (invoice) await logShape('invoice', invoice, now);
      }
      const row = detail ? rowFor(detail, cn) : null;
      const paid = row ? Object.entries(row).some(([k, v]) => /^(payment)?status$/i.test(k) && /^(y|yes|paid|true)$/i.test(String(v))) : false;
      // COD replies carry no booking date: the order's date stands in, so its month's expense counts it.
      const bookedOn = (idx.get(cn) ?? []).map(l => l.date).filter((d): d is string => !!d).sort()[0];
      costs.push(shipmentCost(cn, costsFromCod(detail, invoice, cn), { source: 'tcs-cod', paid, bookedOn }, now));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if (++errors >= 5) break;
    }
  }
  await store(costs, idx, new Map());
  return { costed: costs.length, remaining: Math.max(0, fresh.length - costs.length), ...(error && errors >= 5 ? { error } : {}) };
}

/** The year's parcels costed, their cost and tax (for Settings → TCS), kept in tcs_meta/costs-summary. */
export async function summariseCosts(now: Date): Promise<{ year: number; parcels: number; total: number; tax: number; delivery: number }> {
  const year = now.getUTCFullYear();
  const snap = await COSTS().where('bookedOn', '>=', `${year}-01-01`).select('total', 'tax', 'delivery', 'empty').get();
  let parcels = 0, total = 0, tax = 0, delivery = 0;
  for (const d of snap.docs) {
    const x = d.data() as { total?: number; tax?: number; delivery?: number; empty?: boolean };
    if (x.empty) continue;
    parcels += 1; total += x.total || 0; tax += x.tax || 0; delivery += x.delivery || 0;
  }
  const out = { year, parcels, total: Math.round(total), tax: Math.round(tax), delivery: Math.round(delivery) };
  await META('costs-summary').set({ ...out, at: now.toISOString() });
  return out;
}

/** Parcels costed through the COD API alone (none in OCI's tcs_parcels), shaped for the monthly expense. */
export async function codOnlyParcels(known: Set<string>): Promise<{ cn: string; bookedOn: string; costs: Omit<Costs, 'lines' | 'codCollected' | 'amountPaid'> }[]> {
  const snap = await COSTS().where('source', '==', 'tcs-cod').get();
  return snap.docs.map(d => d.data() as ShipmentCost).filter(c => !known.has(c.cn) && !c.empty && c.bookedOn && c.total > 0).map(c => ({
    cn: c.cn, bookedOn: c.bookedOn,
    costs: { delivery: c.delivery, tax: c.tax, fuel: c.fuel, codFee: c.codFee, insurance: c.insurance, withholding: c.withholding, other: c.other, total: c.total },
  }));
}
