/**
 * What a TCS parcel cost, read from whatever TCS returns (owner, 2026-11-09: "import the tax data / delivery costs / all costs
 * from every shipment"). Pure; the stored side is lib/shipment-costs-server.ts, one `shipment_costs/<cn>` per parcel.
 *
 * TCS's field names for tax and the rest are not known until the account is live, so this reads loosely: every numeric field
 * whose key (case, spaces, dots, underscores ignored) names a charge, tax, fuel, fee, insurance, handling, withholding,
 * service, deduction or commission is a cost line, sorted into a bucket. The raw key → value of each stays in `lines`,
 * so the mapping can be corrected later from `tcs_meta/cost-shape` without losing anything.
 *
 * - `total` = delivery + tax + fuel + codFee + insurance + other: what the parcel cost the shop.
 * - `withholding` (WHT) is tax TCS deducts from the payout: listed on its own, NOT in `total` (so it is never counted twice as
 *   a cost); `netReceived` takes it off the cash.
 * - Money TCS collected or paid out (amount paid, COD amount, collected) is never a cost.
 */

export type CostBucket = 'delivery' | 'tax' | 'fuel' | 'codFee' | 'insurance' | 'withholding' | 'other';
export const COST_BUCKETS: CostBucket[] = ['delivery', 'tax', 'fuel', 'codFee', 'insurance', 'withholding', 'other'];

export interface Costs {
  delivery: number; tax: number; fuel: number; codFee: number; insurance: number; withholding: number; other: number;
  /** delivery + tax + fuel + codFee + insurance + other (withholding is not in it). */
  total: number;
  /** The raw key → value of every field counted (and withholding), as TCS spelt it. */
  lines: Record<string, number>;
  /** COD cash TCS collected from the customer, when the row says. */
  codCollected?: number;
  /** What TCS actually paid out ("amount paid") when it has. */
  amountPaid?: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A number from 1234, "1,234.50", "Rs. 118"; null for anything else (blank, text, a date). */
export function moneyOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^(pkr|rs\.?)\s*/i, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** Money TCS collected or paid out, or a field that is not money at all. Never a cost. */
const NOT_COST = /(amountpaid|paidamount|codamount|collected|collection(amount)?$|^amount$|invoiceamount|weight|date|status|rate|percent|pct|taxable|code$|type$|number$|^no$|orderno|^cn|consignment|pieces|qty|quantity|phone|mobile|zip|postal)/;
const COST_KEY = /(charge|tax|gst|sst|fuel|surcharge|fee|insurance|handling|withhold|wht|service|deduct|commission|freight)/;

/** Which bucket a key belongs to; null when it is not a cost. */
export function bucketOf(key: string): CostBucket | null {
  const k = norm(key);
  if (!k || NOT_COST.test(k) || !COST_KEY.test(k)) return null;
  if (/withhold|wht/.test(k)) return 'withholding';
  if (/tax|gst|sst/.test(k)) return 'tax';
  if (/fuel/.test(k)) return 'fuel';
  if (/insur/.test(k)) return 'insurance';
  if (/cod|cashondelivery|handling|collectionfee/.test(k)) return 'codFee';
  if (/delivery|freight|shipping|courier|carriage|^(total|net|gross)?charges?$/.test(k)) return 'delivery';
  return 'other';
}

/** A "total …" style key: it repeats the parts, so it only stands in when no part is there. */
const isTotalKey = (k: string) => /^(total|grand|net|gross|sub)/.test(norm(k));

const NAME_KEY = /name|type|description|head|title|label/i;
const AMOUNT_KEY = /amount|value|charge|total|price|fee/i;
/** [{name: "GST", amount: 5}, …]: charge lists written as rows. */
function namedAmounts(arr: unknown[]): Array<[string, number]> | null {
  const out: Array<[string, number]> = [];
  for (const it of arr) {
    if (!isObj(it)) return null;
    const name = Object.entries(it).find(([k, v]) => NAME_KEY.test(k) && typeof v === 'string' && v.trim() && moneyOf(v) === null)?.[1] as string | undefined;
    const amt = Object.entries(it).map(([k, v]) => (AMOUNT_KEY.test(k) ? moneyOf(v) : null)).find(v => v !== null);
    if (!name || amt === undefined || amt === null) return null;
    out.push([name, amt]);
  }
  return out.length ? out : null;
}

/** Every [key, primitive] of a row; nested objects join their keys ("charges gst"), charge lists become "charges GST". */
function flatten(row: Obj, prefix = '', depth = 0, out: Array<[string, unknown]> = []): Array<[string, unknown]> {
  for (const [k, v] of Object.entries(row)) {
    const key = prefix ? `${prefix} ${k}` : k;
    if (Array.isArray(v)) {
      const named = namedAmounts(v);
      if (named) for (const [n, a] of named) out.push([`${key} ${n}`, a]);
    } else if (isObj(v)) { if (depth < 3) flatten(v, key, depth + 1, out); }
    else out.push([key, v]);
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The costs in one TCS row (an OCI payment-detail row, a COD payment-details reply row, a payment-invoice line). */
export function costOf(row: Obj): Costs {
  const c: Costs = { delivery: 0, tax: 0, fuel: 0, codFee: 0, insurance: 0, withholding: 0, other: 0, total: 0, lines: {} };
  let standIn = 0;
  for (const [key, raw] of flatten(row)) {
    const n = moneyOf(raw);
    if (n === null) continue;
    const nk = norm(key);
    if (/amountpaid$|^paidamount$/.test(nk)) { if (n > 0) c.amountPaid = (c.amountPaid ?? 0) + n; continue; }
    if (/codamount|collectedamount|amountcollected|^collected$|^collection(amount)?$/.test(nk)) { if (n > 0) c.codCollected = n; continue; }
    const b = bucketOf(key);
    if (!b || n === 0) continue;
    c.lines[key.replace(/[./\[\]*`]/g, ' ').replace(/\s+/g, ' ').trim()] = n;
    if (isTotalKey(key) && (b === 'delivery' || b === 'other')) { if (!standIn) standIn = n; continue; }
    c[b] += n;
  }
  // A lone "total charges" with no parts is the delivery side as a whole.
  if (c.delivery + c.tax + c.fuel + c.codFee + c.insurance + c.other === 0 && standIn) c.delivery = standIn;
  for (const b of COST_BUCKETS) c[b] = r2(c[b]);
  c.total = r2(c.delivery + c.tax + c.fuel + c.codFee + c.insurance + c.other);
  if (c.amountPaid !== undefined) c.amountPaid = r2(c.amountPaid);
  return c;
}

/**
 * The rows inside a reply: the shallowest objects that carry values. A parcel list (an array of rows) gives each row;
 * a charge list ([{name, amount}]) stays inside its parent. returnStatus is skipped.
 */
export function leafRows(reply: unknown, depth = 0, out: Obj[] = []): Obj[] {
  if (depth > 6) return out;
  if (Array.isArray(reply)) { for (const x of reply) leafRows(x, depth + 1, out); return out; }
  if (!isObj(reply)) return out;
  const children: unknown[] = [];
  let hasValue = false;
  for (const [k, v] of Object.entries(reply)) {
    if (/^returnstatus$/i.test(k)) continue;
    if (Array.isArray(v)) { if (v.some(isObj) && !namedAmounts(v)) children.push(v); }
    else if (isObj(v)) { if (Object.values(v).some(x => x !== null && typeof x === 'object')) children.push(v); else hasValue = true; }
    else if (v !== null && v !== undefined && v !== '') hasValue = true;
  }
  if (children.length) {
    const before = out.length;
    for (const ch of children) leafRows(ch, depth + 1, out);
    if (out.length === before && hasValue) out.push(reply);
    return out;
  }
  if (hasValue) out.push(reply);
  return out;
}

/** The row of a reply that is about this parcel (it names the number), else the only row; null when unclear. */
export function rowFor(reply: unknown, cn: string): Obj | null {
  const rows = leafRows(reply);
  const named = rows.find(r => Object.values(r).some(v => String(v ?? '').trim() === cn));
  return named ?? (rows.length === 1 ? rows[0] : null);
}

export type CostSource = 'tcs-oci' | 'tcs-cod';

/** What is stored in shipment_costs/<cn>. */
export interface ShipmentCost extends Omit<Costs, 'codCollected' | 'amountPaid'> {
  cn: string;
  orderId?: string;
  bookedOn: string;
  city: string;
  codCollected?: number;
  /** collected − total − withholding when the cash collected is known; else what TCS paid out when it has. */
  netReceived?: number;
  /** TCS gave no cost for it (yet): asked again after a few days. */
  empty?: boolean;
  source: CostSource;
  updatedAt: string;
}

/** The stored record for a parcel from a costed row. */
export function shipmentCost(cn: string, costs: Costs, meta: { bookedOn?: string; city?: string; orderId?: string; source: CostSource; paid?: boolean }, now: Date): ShipmentCost {
  const { codCollected, amountPaid, ...rest } = costs;
  const net = codCollected !== undefined ? r2(codCollected - costs.total - costs.withholding) : meta.paid && amountPaid ? amountPaid : undefined;
  return {
    ...rest, cn, bookedOn: meta.bookedOn || '', city: meta.city || '', source: meta.source, updatedAt: now.toISOString(),
    ...(meta.orderId ? { orderId: meta.orderId } : {}),
    ...(codCollected !== undefined ? { codCollected } : {}),
    ...(net !== undefined ? { netReceived: net } : {}),
    ...(costs.total === 0 && costs.withholding === 0 ? { empty: true } : {}),
  };
}

/** The slice written onto an order or invoice (`shippingCost`): never a money total of the sale. */
export interface ShippingCost {
  cn: string; total: number; delivery: number; tax: number; fuel: number; codFee: number; insurance: number; withholding: number; other: number;
  netReceived?: number; updatedAt: string;
}
export function shippingCostOf(c: ShipmentCost): ShippingCost {
  return {
    cn: c.cn, total: c.total, delivery: c.delivery, tax: c.tax, fuel: c.fuel, codFee: c.codFee, insurance: c.insurance,
    withholding: c.withholding, other: c.other, ...(c.netReceived !== undefined ? { netReceived: c.netReceived } : {}), updatedAt: c.updatedAt,
  };
}
/** Same costs (ignoring when they were read)? Then the order is not rewritten. */
export const sameShippingCost = (a: Partial<ShippingCost> | undefined, b: ShippingCost) =>
  !!a && COST_BUCKETS.every(k => (a[k] ?? 0) === b[k]) && a.total === b.total && a.cn === b.cn && a.netReceived === b.netReceived;

/** The ids an order may have for the reference the shop sent TCS at booking ("Internet 591128", "SHOPIFY-1042", "1042"). */
export function orderIdCandidates(orderNo: string): string[] {
  const t = orderNo.trim();
  if (!t) return [];
  const ids = new Set<string>();
  if (!t.includes('/')) ids.add(t);
  const d = /(\d{3,})\s*$/.exec(t);
  if (d) ids.add(`SHOPIFY-${d[1]}`);
  return [...ids];
}

/** "8,400" */
const fmt = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "TCS, November 2026: 42 parcels — delivery 8,400, tax 1,344, fuel 600" (only the parts that are there). */
export function costDescription(month: string, n: number, t: Pick<Costs, 'delivery' | 'tax' | 'fuel' | 'codFee' | 'insurance' | 'other'>): string {
  const [y, mo] = month.split('-').map(Number);
  const parts = ([['delivery', t.delivery], ['tax', t.tax], ['fuel', t.fuel], ['COD fee', t.codFee], ['insurance', t.insurance], ['other', t.other]] as const)
    .filter(([, v]) => Math.round(v) >= 1).map(([l, v]) => `${l} ${fmt(v)}`);
  return `TCS, ${MONTHS[mo - 1]} ${y}: ${n} parcel${n === 1 ? '' : 's'}${parts.length ? ` — ${parts.join(', ')}` : ' sent'}`;
}

/** "delivery 118 · tax 19 · other 5" for the order page (zero parts left out). */
export function costBreakdown(c: Pick<ShippingCost, 'delivery' | 'tax' | 'fuel' | 'codFee' | 'insurance' | 'other'>): string {
  const other = c.fuel + c.codFee + c.insurance + c.other;
  return ([['delivery', c.delivery], ['tax', c.tax], ['other', other]] as const).filter(([, v]) => Math.round(v) >= 1).map(([l, v]) => `${l} ${fmt(v)}`).join(' · ');
}
