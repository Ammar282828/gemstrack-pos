/**
 * Shopify's own analytics for the house whose public store is Shopify (House of Mina, houseofmina.store), read through
 * the Admin GraphQL API (the owner, 2026-11-03: "add all Shopify website insights like who's live and everything …
 * ALL"). Server-side only; the Admin API is reached through an injected `gql` (the routes pass `shopifyGraphQL` with
 * the shop's token), so everything here is pure or mockable.
 *
 *   ShopifyQL  `shopifyqlQuery(query:)`  needs the `read_reports` scope (and, Shopify says, level-2 protected customer
 *              data for some tables). Datasets used: `sales`, `sessions`, `searches`. Each query runs for the period and,
 *              when asked, for the one before it, with explicit dates (no COMPARE TO: its column names aren't stable).
 *   Live       Shopify has no Live View API. Stand-ins: sessions by the minute from ShopifyQL (falls back to the hour),
 *              today's sessions by place, and orders / abandoned checkouts of the last 30 minutes (`read_orders`).
 *
 * Every section comes back as `{ data }`, `{ missingScope }` (the page says what to grant) or `{ error }`; one section
 * failing never takes the others down. Granted scopes are read at run time (`currentAppInstallation.accessScopes`).
 */

import { addDays, daysBetween } from '@/lib/website/site-analytics';

export type Gql = (query: string, variables?: Record<string, unknown>) => Promise<any>;
export type Section<T> = { data: T } | { missingScope: string; note?: string } | { error: string };

export const RANGES = ['today', '7d', '30d', '90d', 'month'] as const;
export type RangeKey = typeof RANGES[number];
export interface Window { from: string; to: string }

export const SCOPE_REPORTS = 'read_reports';
export const SCOPE_ORDERS = 'read_orders';

// ── periods ────────────────────────────────────────────────────────────────

export function parseRange(x: string | null | undefined): RangeKey {
  return (RANGES as readonly string[]).includes(x ?? '') ? (x as RangeKey) : '30d';
}

/** The period (Karachi days up to `today`) and the one before it, of the same length; a month is set against last month's same days. */
export function resolveWindow(range: RangeKey, today: string): { range: RangeKey; from: string; to: string; days: number; previous: Window } {
  if (range === 'month') {
    const from = `${today.slice(0, 7)}-01`;
    const days = daysBetween(from, today);
    const prevLast = addDays(from, -1), prevFrom = `${prevLast.slice(0, 7)}-01`;
    const prevTo = addDays(prevFrom, days - 1);
    return { range, from, to: today, days, previous: { from: prevFrom, to: prevTo > prevLast ? prevLast : prevTo } };
  }
  const days = range === 'today' ? 1 : range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const from = addDays(today, -(days - 1));
  return { range, from, to: today, days, previous: { from: addDays(from, -days), to: addDays(from, -1) } };
}

// ── ShopifyQL builders ─────────────────────────────────────────────────────

const win = (w: Window) => `SINCE ${w.from} UNTIL ${w.to}`;
export const grainFor = (w: Window): 'hour' | 'day' => (w.from === w.to ? 'hour' : 'day');

export const SALES_METRICS = ['total_sales', 'gross_sales', 'net_sales', 'orders', 'average_order_value', 'discounts', 'taxes', 'shipping_charges', 'net_items_sold', 'new_customers', 'returning_customers', 'returning_customer_rate'] as const;
export const TRAFFIC_METRICS = [
  'sessions', 'online_store_visitors', 'pageviews', 'pageviews_per_session', 'bounce_rate', 'average_session_duration', 'conversion_rate',
  'added_to_cart_rate', 'reached_checkout_rate', 'completed_checkout_rate', 'sessions_with_cart_additions', 'sessions_that_reached_checkout',
  'sessions_that_completed_checkout', 'searches_submitted', 'products_viewed',
] as const;

export const Q = {
  sales: (w: Window) => `FROM sales SHOW ${SALES_METRICS.join(', ')} ${win(w)}`,
  traffic: (w: Window) => `FROM sessions SHOW ${TRAFFIC_METRICS.join(', ')} ${win(w)}`,
  salesSeries: (w: Window) => `FROM sales SHOW total_sales, orders TIMESERIES ${grainFor(w)} ${win(w)} ORDER BY ${grainFor(w)} ASC`,
  sessionSeries: (w: Window) => `FROM sessions SHOW sessions, online_store_visitors TIMESERIES ${grainFor(w)} ${win(w)} ORDER BY ${grainFor(w)} ASC`,
  products: (w: Window) => `FROM sales SHOW net_sales, net_items_sold, orders GROUP BY product_title ${win(w)} ORDER BY net_sales DESC LIMIT 15`,
  channels: (w: Window) => `FROM sales SHOW net_sales, orders GROUP BY sales_channel ${win(w)} ORDER BY net_sales DESC LIMIT 10`,
  discounts: (w: Window) => `FROM sales SHOW discounts, orders GROUP BY discount_code ${win(w)} ORDER BY discounts DESC LIMIT 15`,
  customers: (w: Window) => `FROM sales SHOW total_sales, orders GROUP BY new_or_returning_customer ${win(w)}`,
  sources: (w: Window) => `FROM sessions SHOW sessions, conversion_rate, sessions_that_completed_checkout GROUP BY referrer_source, referrer_name ${win(w)} ORDER BY sessions DESC LIMIT 20`,
  places: (w: Window) => `FROM sessions SHOW sessions, sessions_that_completed_checkout GROUP BY session_country_code, session_country, session_city ${win(w)} ORDER BY sessions DESC LIMIT 40`,
  devices: (w: Window) => `FROM sessions SHOW sessions, conversion_rate GROUP BY session_device_type ${win(w)} ORDER BY sessions DESC LIMIT 10`,
  landing: (w: Window) => `FROM sessions SHOW sessions, bounce_rate, conversion_rate GROUP BY landing_page_path ${win(w)} ORDER BY sessions DESC LIMIT 50`,
  searches: (w: Window) => `FROM searches SHOW searches GROUP BY search_query ${win(w)} ORDER BY searches DESC LIMIT 20`,
  // Live stand-ins
  liveMinutes: () => 'FROM sessions SHOW sessions TIMESERIES minute SINCE -1h ORDER BY minute ASC',
  liveHours: () => 'FROM sessions SHOW sessions TIMESERIES hour DURING today ORDER BY hour ASC',
  livePlaces: () => 'FROM sessions SHOW sessions GROUP BY session_country_code, session_country, session_city DURING today ORDER BY sessions DESC LIMIT 15',
  liveToday: () => 'FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout DURING today',
} as const;

export const SCOPES_QUERY = '{ currentAppInstallation { accessScopes { handle } } }';
export const SHOP_QUERY = '{ shop { name currencyCode ianaTimezone } }';
const SHOPIFYQL = `query ShopifyQL($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name dataType displayName } rows } } }`;

// ── running and mapping ────────────────────────────────────────────────────

export type Row = Record<string, string | number | null>;
const NUMERIC = /^(INTEGER|FLOAT|DECIMAL|MONEY|PERCENT|[A-Z_]*DURATION|NUMBER|PERCENTAGE)$/;

export class ShopifyqlParseError extends Error {}

/** The table of a `shopifyqlQuery` response with its numbers as numbers; throws on a parse error. */
export function mapTable(resp: any): Row[] {
  const r = resp?.shopifyqlQuery;
  const errs: unknown[] = r?.parseErrors ?? [];
  if (errs.length) throw new ShopifyqlParseError(errs.map(e => (typeof e === 'string' ? e : (e as any)?.message ?? JSON.stringify(e))).join('; ').slice(0, 300));
  const cols: { name: string; dataType?: string }[] = r?.tableData?.columns ?? [];
  const raw = r?.tableData?.rows ?? [];
  const rows: any[] = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const kind = new Map(cols.map(c => [c.name, c.dataType ?? '']));
  return rows.map(row => {
    const o: Row = {};
    const entries: [string, unknown][] = Array.isArray(row) ? cols.map((c, i) => [c.name, row[i]]) : Object.entries(row);
    for (const [k, v] of entries) {
      if (v === null || v === undefined || v === '') o[k] = null;
      else if (NUMERIC.test(kind.get(k) ?? '') || (typeof v === 'number')) { const n = Number(v); o[k] = Number.isFinite(n) ? n : null; }
      else o[k] = String(v);
    }
    return o;
  });
}

export async function shopifyql(gql: Gql, query: string): Promise<Row[]> {
  return mapTable(await gql(SHOPIFYQL, { q: query }));
}

/** Granted scope handles, or null when they couldn't be read (the sections are then tried and judged by their errors). */
export async function grantedScopes(gql: Gql): Promise<string[] | null> {
  try {
    const d = await gql(SCOPES_QUERY);
    const list = d?.currentAppInstallation?.accessScopes;
    return Array.isArray(list) ? list.map((s: any) => String(s.handle)) : null;
  } catch { return null; }
}

/** read_all_orders implies read_orders. */
export const hasScope = (granted: string[] | null, scope: string) =>
  granted === null ? true : granted.includes(scope) || (scope === SCOPE_ORDERS && granted.includes('read_all_orders'));

const DENIED = /access denied|access_denied|not approved|requires? (merchant approval|.*scope)|read_reports|read_orders|protected customer|forbidden|unauthori[sz]ed|\b40[13]\b/i;

/** An Admin API failure as a section: the scope to grant if it reads like a permission problem, else the message. */
export function classify(e: unknown, scope: string): { missingScope: string; note?: string } | { error: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof ShopifyqlParseError) return { error: msg };
  if (DENIED.test(msg)) return { missingScope: scope, note: /protected customer/i.test(msg) ? 'Shopify also wants protected customer data (level 2) approved for the app.' : undefined };
  return { error: msg.slice(0, 200) };
}

export async function guarded<T>(granted: string[] | null, scope: string, fn: () => Promise<T>): Promise<Section<T>> {
  if (!hasScope(granted, scope)) return { missingScope: scope };
  try { return { data: await fn() }; } catch (e) { return classify(e, scope); }
}

/** At most `limit` of the tasks at once. */
export async function pool<T>(tasks: (() => Promise<T>)[], limit = 4): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); }
  }));
  return out;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

// ── shapes ─────────────────────────────────────────────────────────────────

export interface Metric { value: number; before: number | null }
export type Kpis = Record<string, Metric>;
export interface ListRow { key: string; label: string; code?: string; value: number; before: number | null; extra?: Record<string, number | null> }

const KPI_NAMES: Record<string, string> = {
  total_sales: 'totalSales', gross_sales: 'grossSales', net_sales: 'netSales', orders: 'orders', average_order_value: 'averageOrderValue', discounts: 'discounts',
  taxes: 'taxes', shipping_charges: 'shipping', net_items_sold: 'itemsSold', new_customers: 'newCustomers', returning_customers: 'returningCustomers',
  returning_customer_rate: 'returningCustomerRate',
  sessions: 'sessions', online_store_visitors: 'visitors', pageviews: 'pageviews', pageviews_per_session: 'pageviewsPerSession', bounce_rate: 'bounceRate',
  average_session_duration: 'avgSessionSeconds', conversion_rate: 'conversionRate', added_to_cart_rate: 'addedToCartRate', reached_checkout_rate: 'reachedCheckoutRate',
  completed_checkout_rate: 'completedCheckoutRate', sessions_with_cart_additions: 'addedToCart', sessions_that_reached_checkout: 'reachedCheckout',
  sessions_that_completed_checkout: 'completedCheckout', searches_submitted: 'searches', products_viewed: 'productsViewed',
};

/** One-row ShopifyQL results (now, before) as named metrics. Rates are fractions (0.034 = 3.4%). */
export function mapKpis(now: Row[], before: Row[] | null): Kpis {
  const a = now[0] ?? {}, b = before ? before[0] ?? {} : null;
  const out: Kpis = {};
  for (const [col, name] of Object.entries(KPI_NAMES)) {
    if (!(col in a) && !(b && col in b)) continue;
    out[name] = { value: num(a[col]), before: b ? num(b[col]) : null };
  }
  return out;
}

/** The funnel Shopify draws: sessions → added to cart → reached checkout → completed. */
export function mapFunnel(k: Kpis) {
  const steps = [
    { key: 'sessions', label: 'Sessions', ...pick(k.sessions) },
    { key: 'addedToCart', label: 'Added to cart', ...pick(k.addedToCart) },
    { key: 'reachedCheckout', label: 'Reached checkout', ...pick(k.reachedCheckout) },
    { key: 'completedCheckout', label: 'Completed checkout', ...pick(k.completedCheckout) },
  ];
  return steps;
}
const pick = (m?: Metric) => ({ value: m?.value ?? 0, before: m?.before ?? null });

/** Two-key join of the period's rows with the previous period's. */
export function mapList(now: Row[], before: Row[] | null, o: { keys: string[]; label: (r: Row) => string; value: string; extras?: string[]; skipEmpty?: boolean; code?: string }): ListRow[] {
  const id = (r: Row) => o.keys.map(k => str(r[k])).join('|');
  const prev = before ? new Map(before.map(r => [id(r), num(r[o.value])])) : null;
  return now
    .map(r => {
      const label = o.label(r);
      const row: ListRow = { key: id(r), label, value: num(r[o.value]), before: prev ? prev.get(id(r)) ?? 0 : null };
      if (o.code) row.code = str(r[o.code]);
      if (o.extras?.length) row.extra = Object.fromEntries(o.extras.map(e => [e, r[e] === null || r[e] === undefined ? null : num(r[e])]));
      return row;
    })
    .filter(r => !(o.skipEmpty && (!r.label || r.label === '—')))
    .sort((x, y) => y.value - x.value);
}

export const sourceLabel = (r: Row) => str(r.referrer_name) || str(r.referrer_source) || 'Direct';
export const placeLabel = (r: Row) => [str(r.session_city), str(r.session_country)].filter(Boolean).join(', ') || 'Unknown';

export function mapSeries(sales: Row[], traffic: Row[], grain: 'hour' | 'day') {
  const k = grain;
  const by = new Map<string, { at: string; sessions: number; visitors: number; sales: number; orders: number }>();
  const at = (r: Row) => str(r[k]);
  const slot = (a: string) => { if (!by.has(a)) by.set(a, { at: a, sessions: 0, visitors: 0, sales: 0, orders: 0 }); return by.get(a)!; };
  for (const r of traffic) if (at(r)) { const s = slot(at(r)); s.sessions = num(r.sessions); s.visitors = num(r.online_store_visitors); }
  for (const r of sales) if (at(r)) { const s = slot(at(r)); s.sales = num(r.total_sales); s.orders = num(r.orders); }
  return [...by.values()].sort((a, b) => a.at.localeCompare(b.at));
}

// ── the report ─────────────────────────────────────────────────────────────

export interface ReportOptions { range: RangeKey; compare: boolean; today: string }

export async function buildReport(gql: Gql, o: ReportOptions) {
  const w = resolveWindow(o.range, o.today);
  const granted = await grantedScopes(gql);
  const shop = await gql(SHOP_QUERY).then(d => d?.shop ?? null).catch(() => null);
  const run = (q: (w: Window) => string) => (p: Window) => () => shopifyql(gql, q(p));
  const both = async <T>(q: (w: Window) => string, map: (now: Row[], before: Row[] | null) => T): Promise<Section<T>> =>
    guarded(granted, SCOPE_REPORTS, async () => {
      const [now, before] = await pool([run(q)(w), ...(o.compare ? [run(q)(w.previous)] : [])]);
      return map(now, o.compare ? before : null);
    });

  const tasks = {
    sales: () => both(Q.sales, mapKpis),
    traffic: () => both(Q.traffic, mapKpis),
    series: () => guarded(granted, SCOPE_REPORTS, async () => {
      const [s, t] = await Promise.all([shopifyql(gql, Q.salesSeries(w)), shopifyql(gql, Q.sessionSeries(w))]);
      return { grain: grainFor(w), points: mapSeries(s, t, grainFor(w)) };
    }),
    products: () => both(Q.products, (n, b) => mapList(n, b, { keys: ['product_title'], label: r => str(r.product_title), value: 'net_sales', extras: ['net_items_sold', 'orders'], skipEmpty: true })),
    channels: () => both(Q.channels, (n, b) => mapList(n, b, { keys: ['sales_channel'], label: r => str(r.sales_channel) || 'Other', value: 'net_sales', extras: ['orders'] })),
    discounts: () => both(Q.discounts, (n, b) => mapList(n, b, { keys: ['discount_code'], label: r => str(r.discount_code), value: 'discounts', extras: ['orders'], skipEmpty: true })),
    customers: () => both(Q.customers, (n, b) => mapList(n, b, { keys: ['new_or_returning_customer'], label: r => str(r.new_or_returning_customer) || 'Unknown', value: 'total_sales', extras: ['orders'] })),
    sources: () => both(Q.sources, (n, b) => mapList(n, b, { keys: ['referrer_source', 'referrer_name'], label: sourceLabel, value: 'sessions', extras: ['conversion_rate', 'sessions_that_completed_checkout'] })),
    places: () => both(Q.places, (n, b) => mapList(n, b, { keys: ['session_country_code', 'session_city'], label: placeLabel, value: 'sessions', extras: ['sessions_that_completed_checkout'], code: 'session_country_code' })),
    devices: () => both(Q.devices, (n, b) => mapList(n, b, { keys: ['session_device_type'], label: r => str(r.session_device_type) || 'Unknown', value: 'sessions', extras: ['conversion_rate'] })),
    landing: () => both(Q.landing, (n, b) => mapList(n, b, { keys: ['landing_page_path'], label: r => str(r.landing_page_path) || '/', value: 'sessions', extras: ['bounce_rate', 'conversion_rate'] })),
    searches: () => both(Q.searches, (n, b) => mapList(n, b, { keys: ['search_query'], label: r => str(r.search_query), value: 'searches', skipEmpty: true })),
  };
  const names = Object.keys(tasks) as (keyof typeof tasks)[];
  const results = await pool(names.map(n => tasks[n] as () => Promise<Section<any>>), 4);
  const sections = Object.fromEntries(names.map((n, i) => [n, results[i]])) as { [K in keyof typeof tasks]: Section<any> };

  // Derived without another query: the funnel, and the product pages people land on (Shopify has no per-product views table).
  const funnel: Section<ReturnType<typeof mapFunnel>> = 'data' in sections.traffic ? { data: mapFunnel(sections.traffic.data as Kpis) } : sections.traffic as any;
  const productPages: Section<ListRow[]> = 'data' in sections.landing
    ? { data: (sections.landing.data as ListRow[]).filter(r => r.key.startsWith('/products/')).slice(0, 15) } : sections.landing as any;

  return {
    range: w.range, from: w.from, to: w.to, days: w.days, previous: o.compare ? w.previous : null, today: o.today,
    shop: shop ? { name: str(shop.name), currency: str(shop.currencyCode), timezone: str(shop.ianaTimezone) } : null,
    scopes: { granted, checked: granted !== null, needs: [SCOPE_REPORTS] },
    at: Date.now(),
    sections: { ...sections, funnel, productPages },
  };
}

// ── live ───────────────────────────────────────────────────────────────────

export const LIVE_WINDOW_MS = 30 * 60_000;

export const ORDERS_QUERY = `query Recent($q: String!) { orders(first: 25, sortKey: CREATED_AT, reverse: true, query: $q) { nodes {
  name createdAt displayFinancialStatus sourceName
  currentTotalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { city countryCodeV2 }
  lineItems(first: 3) { nodes { title quantity } } } } }`;
export const CHECKOUTS_QUERY = `query Open($q: String!) { abandonedCheckouts(first: 25, sortKey: CREATED_AT, reverse: true, query: $q) { nodes {
  createdAt completedAt
  totalPriceSet { shopMoney { amount currencyCode } }
  shippingAddress { city countryCodeV2 }
  lineItems(first: 3) { nodes { title quantity } } } } }`;

export interface Activity { kind: 'order' | 'checkout'; at: string; ago: number; label: string; amount: number | null; currency: string; place: string; items: { title: string; quantity: number }[]; status?: string; channel?: string }

const place = (a: any) => [a?.city, a?.countryCodeV2].filter(Boolean).join(', ');
const items = (n: any) => (n?.lineItems?.nodes ?? []).map((l: any) => ({ title: String(l.title ?? ''), quantity: Number(l.quantity ?? 1) }));

export function mapOrders(d: any, now: number): Activity[] {
  return (d?.orders?.nodes ?? []).map((n: any): Activity => ({
    kind: 'order', at: n.createdAt, ago: Math.max(0, now - Date.parse(n.createdAt)), label: String(n.name ?? ''),
    amount: n.currentTotalPriceSet ? Number(n.currentTotalPriceSet.shopMoney.amount) : null, currency: n.currentTotalPriceSet?.shopMoney.currencyCode ?? '',
    place: place(n.shippingAddress), items: items(n), status: n.displayFinancialStatus ?? undefined, channel: n.sourceName ?? undefined,
  }));
}
export function mapCheckouts(d: any, now: number): Activity[] {
  return (d?.abandonedCheckouts?.nodes ?? []).map((n: any): Activity => ({
    kind: 'checkout', at: n.createdAt, ago: Math.max(0, now - Date.parse(n.createdAt)), label: n.completedAt ? 'Checkout completed' : 'Checkout started',
    amount: n.totalPriceSet ? Number(n.totalPriceSet.shopMoney.amount) : null, currency: n.totalPriceSet?.shopMoney.currencyCode ?? '',
    place: place(n.shippingAddress), items: items(n),
  }));
}

export async function buildLive(gql: Gql, nowMs = Date.now()) {
  const granted = await grantedScopes(gql);
  const since = new Date(nowMs - LIVE_WINDOW_MS).toISOString();
  const [sessions, places, today, orders, checkouts] = await Promise.all([
    guarded(granted, SCOPE_REPORTS, async () => {
      try { return { grain: 'minute' as const, points: (await shopifyql(gql, Q.liveMinutes())).map(r => ({ at: str(r.minute), sessions: num(r.sessions) })) }; }
      catch (e) { if (!(e instanceof ShopifyqlParseError)) throw e; }
      return { grain: 'hour' as const, points: (await shopifyql(gql, Q.liveHours())).map(r => ({ at: str(r.hour), sessions: num(r.sessions) })) };
    }),
    guarded(granted, SCOPE_REPORTS, async () => mapList(await shopifyql(gql, Q.livePlaces()), null, { keys: ['session_country_code', 'session_city'], label: placeLabel, value: 'sessions', code: 'session_country_code' })),
    guarded(granted, SCOPE_REPORTS, async () => mapKpis(await shopifyql(gql, Q.liveToday()), null)),
    guarded(granted, SCOPE_ORDERS, async () => mapOrders(await gql(ORDERS_QUERY, { q: `created_at:>='${since}'` }), nowMs)),
    guarded(granted, SCOPE_ORDERS, async () => mapCheckouts(await gql(CHECKOUTS_QUERY, { q: `created_at:>='${since}'` }), nowMs)),
  ]);
  // Last half hour's sessions, summed from the minute grain; null when only hours are available.
  const lastHalfHour = 'data' in sessions && sessions.data.grain === 'minute'
    ? sessions.data.points.filter(p => Date.parse(p.at) >= nowMs - LIVE_WINDOW_MS).reduce((a, p) => a + p.sessions, 0) : null;
  const recent: Section<Activity[]> | { missingScope: string } =
    'data' in orders || 'data' in checkouts
      ? { data: [...('data' in orders ? orders.data : []), ...('data' in checkouts ? checkouts.data : [])].sort((a, b) => a.ago - b.ago) }
      : orders;
  return {
    at: nowMs, windowMinutes: LIVE_WINDOW_MS / 60_000,
    scopes: { granted, checked: granted !== null, needs: [SCOPE_REPORTS, SCOPE_ORDERS] },
    live: { sessionsLastHalfHour: lastHalfHour, note: 'Shopify has no Live View API: this is sessions by the minute (reports lag by a few minutes), plus orders and checkouts of the last 30 minutes.' },
    sections: { sessions, places, today, orders, checkouts, recent },
  };
}

// ── a small cache ──────────────────────────────────────────────────────────

const store = new Map<string, { at: number; v: unknown }>();
export async function cached<T>(key: string, ttlMs: number, make: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.v as T;
  const v = await make();
  store.set(key, { at: now, v });
  if (store.size > 50) store.delete(store.keys().next().value as string);
  return v;
}
export const clearCache = () => store.clear();
