import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLive, buildReport, cached, clearCache, classify, grantedScopes, mapKpis, mapTable, parseRange, Q, resolveWindow, shopifyql,
  ShopifyqlParseError, type Gql,
} from './shopify-analytics';

const table = (columns: [string, string][], rows: Record<string, unknown>[]) => ({
  shopifyqlQuery: { parseErrors: [], tableData: { columns: columns.map(([name, dataType]) => ({ name, dataType, displayName: name })), rows } },
});
const scopes = (...h: string[]) => ({ currentAppInstallation: { accessScopes: h.map(handle => ({ handle })) } });

/** A mock Admin API: routes by what the query text mentions. */
function mock(handlers: { scopes?: string[] | Error; ql?: (q: string) => any; orders?: any; checkouts?: any }): Gql & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (query: string, vars?: Record<string, unknown>) => {
    if (query.includes('accessScopes')) { if (handlers.scopes instanceof Error) throw handlers.scopes; return scopes(...(handlers.scopes ?? ['read_reports', 'read_orders'])); }
    if (query.includes('currencyCode ianaTimezone')) return { shop: { name: 'House of Mina', currencyCode: 'PKR', ianaTimezone: 'Asia/Karachi' } };
    if (query.includes('shopifyqlQuery')) { calls.push(String(vars?.q)); return handlers.ql ? handlers.ql(String(vars?.q)) : table([], []); }
    if (query.includes('orders(')) return handlers.orders ?? { orders: { nodes: [] } };
    if (query.includes('abandonedCheckouts')) return handlers.checkouts ?? { abandonedCheckouts: { nodes: [] } };
    throw new Error('unexpected ' + query);
  }) as Gql & { calls: string[] };
  f.calls = calls;
  return f;
}

beforeEach(() => clearCache());

describe('periods', () => {
  it('parses ranges, defaulting to 30 days', () => {
    expect(parseRange('7d')).toBe('7d'); expect(parseRange('all')).toBe('30d'); expect(parseRange(null)).toBe('30d');
  });
  it('the period and the same length before it', () => {
    expect(resolveWindow('today', '2026-11-03')).toMatchObject({ from: '2026-11-03', to: '2026-11-03', previous: { from: '2026-11-02', to: '2026-11-02' } });
    expect(resolveWindow('7d', '2026-11-03')).toMatchObject({ from: '2026-10-28', previous: { from: '2026-10-21', to: '2026-10-27' } });
  });
  it('a month against last month\'s same days, clipped to its end', () => {
    expect(resolveWindow('month', '2026-11-03')).toMatchObject({ from: '2026-11-01', days: 3, previous: { from: '2026-10-01', to: '2026-10-03' } });
    expect(resolveWindow('month', '2026-03-31').previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('ShopifyQL builders', () => {
  const w = { from: '2026-10-01', to: '2026-10-31' };
  it('write explicit dates and the right datasets', () => {
    expect(Q.sales(w)).toMatch(/^FROM sales SHOW total_sales.*SINCE 2026-10-01 UNTIL 2026-10-31$/);
    expect(Q.traffic(w)).toContain('FROM sessions SHOW sessions, online_store_visitors');
    expect(Q.searches(w)).toContain('FROM searches SHOW searches GROUP BY search_query');
    expect(Q.products(w)).toContain('GROUP BY product_title');
    expect(Q.places(w)).toContain('GROUP BY session_country_code, session_country, session_city');
  });
  it('series by the hour for one day, by the day otherwise', () => {
    expect(Q.salesSeries({ from: '2026-11-03', to: '2026-11-03' })).toContain('TIMESERIES hour');
    expect(Q.sessionSeries(w)).toContain('TIMESERIES day');
  });
});

describe('response mapping', () => {
  it('turns numeric columns into numbers and keeps text', () => {
    const rows = mapTable(table([['sessions', 'INTEGER'], ['conversion_rate', 'PERCENT'], ['landing_page_path', 'STRING']],
      [{ sessions: '120', conversion_rate: '0.034', landing_page_path: '/' }, { sessions: null, conversion_rate: '', landing_page_path: '/x' }]));
    expect(rows).toEqual([{ sessions: 120, conversion_rate: 0.034, landing_page_path: '/' }, { sessions: null, conversion_rate: null, landing_page_path: '/x' }]);
  });
  it('accepts array rows and JSON-string rows', () => {
    const t = { shopifyqlQuery: { parseErrors: [], tableData: { columns: [{ name: 'a', dataType: 'INTEGER' }, { name: 'b', dataType: 'STRING' }], rows: JSON.stringify([['3', 'x']]) } } };
    expect(mapTable(t)).toEqual([{ a: 3, b: 'x' }]);
  });
  it('throws a parse error with its message', () => {
    expect(() => mapTable({ shopifyqlQuery: { parseErrors: ['Unknown field foo'], tableData: null } })).toThrow(ShopifyqlParseError);
  });
  it('kpis carry the previous period', () => {
    const k = mapKpis([{ total_sales: 200, orders: 4 }], [{ total_sales: 100, orders: 5 }]);
    expect(k.totalSales).toEqual({ value: 200, before: 100 });
    expect(mapKpis([{ orders: 4 }], null).orders).toEqual({ value: 4, before: null });
  });
});

describe('scopes', () => {
  it('reads granted scopes, null when it cannot', async () => {
    expect(await grantedScopes(mock({ scopes: ['read_orders'] }))).toEqual(['read_orders']);
    expect(await grantedScopes(mock({ scopes: new Error('boom') }))).toBeNull();
  });
  it('classifies a permission failure as a missing scope', () => {
    expect(classify(new Error('Shopify GraphQL errors: [{"extensions":{"code":"ACCESS_DENIED"}}]'), 'read_reports')).toEqual({ missingScope: 'read_reports' });
    expect(classify(new Error('Access denied for shopifyqlQuery: protected customer data'), 'read_reports')).toMatchObject({ missingScope: 'read_reports', note: expect.stringContaining('level 2') });
    expect(classify(new Error('timeout'), 'read_reports')).toEqual({ error: 'timeout' });
    expect(classify(new ShopifyqlParseError('bad'), 'read_reports')).toEqual({ error: 'bad' });
  });
});

describe('buildReport', () => {
  it('without read_reports every section says what to grant and no ShopifyQL runs', async () => {
    const gql = mock({ scopes: ['read_products'] });
    const r = await buildReport(gql, { range: '30d', compare: true, today: '2026-11-03' });
    expect(gql.calls).toHaveLength(0);
    for (const k of ['sales', 'traffic', 'series', 'funnel', 'products', 'sources', 'places', 'devices', 'landing', 'searches', 'productPages'] as const)
      expect(r.sections[k]).toEqual({ missingScope: 'read_reports' });
    expect(r.scopes).toMatchObject({ granted: ['read_products'], checked: true });
    expect(r.shop).toEqual({ name: 'House of Mina', currency: 'PKR', timezone: 'Asia/Karachi' });
  });

  it('when scopes cannot be read, sections are tried and a denial becomes the missing scope', async () => {
    const gql = mock({ scopes: new Error('no'), ql: () => { throw new Error('Shopify GraphQL errors: ACCESS_DENIED'); } });
    const r = await buildReport(gql, { range: '7d', compare: false, today: '2026-11-03' });
    expect(r.scopes.checked).toBe(false);
    expect(r.sections.sales).toEqual({ missingScope: 'read_reports' });
  });

  it('maps data with the previous period, derives the funnel and product pages, isolates a failing section', async () => {
    const gql = mock({
      ql: q => {
        const prev = q.includes('UNTIL 2026-10-04'); // the previous 30 days
        if (q.startsWith('FROM sales SHOW total_sales, gross_sales')) return table([['total_sales', 'MONEY'], ['orders', 'INTEGER']], [{ total_sales: prev ? '100' : '300', orders: prev ? '1' : '3' }]);
        if (q.startsWith('FROM sessions SHOW sessions, online_store_visitors, pageviews')) return table([['sessions', 'INTEGER'], ['sessions_with_cart_additions', 'INTEGER'], ['sessions_that_reached_checkout', 'INTEGER'], ['sessions_that_completed_checkout', 'INTEGER']],
          [prev ? { sessions: '50', sessions_with_cart_additions: '5', sessions_that_reached_checkout: '2', sessions_that_completed_checkout: '1' } : { sessions: '100', sessions_with_cart_additions: '10', sessions_that_reached_checkout: '4', sessions_that_completed_checkout: '3' }]);
        if (q.includes('GROUP BY landing_page_path')) return table([['landing_page_path', 'STRING'], ['sessions', 'INTEGER']], prev ? [{ landing_page_path: '/', sessions: '20' }] : [{ landing_page_path: '/', sessions: '60' }, { landing_page_path: '/products/ring', sessions: '30' }]);
        if (q.includes('GROUP BY product_title')) return table([['product_title', 'STRING'], ['net_sales', 'MONEY']], [{ product_title: 'Ring', net_sales: '90' }, { product_title: '', net_sales: '5' }]);
        if (q.includes('FROM searches')) return { shopifyqlQuery: { parseErrors: ['Unknown dataset searches'], tableData: null } };
        return table([], []);
      },
    });
    const r = await buildReport(gql, { range: '30d', compare: true, today: '2026-11-03' });
    expect((r.sections.sales as any).data.totalSales).toEqual({ value: 300, before: 100 });
    expect((r.sections.funnel as any).data.map((s: any) => [s.key, s.value, s.before])).toEqual([['sessions', 100, 50], ['addedToCart', 10, 5], ['reachedCheckout', 4, 2], ['completedCheckout', 3, 1]]);
    expect((r.sections.landing as any).data.map((x: any) => [x.key, x.value, x.before])).toEqual([['/', 60, 20], ['/products/ring', 30, 0]]);
    expect((r.sections.productPages as any).data.map((x: any) => x.key)).toEqual(['/products/ring']);
    expect((r.sections.products as any).data.map((x: any) => x.label)).toEqual(['Ring']);
    expect(r.sections.searches).toEqual({ error: 'Unknown dataset searches' });
    expect(r.previous).toEqual({ from: '2026-09-05', to: '2026-10-04' });
  });

  it('skips the previous-period queries unless asked', async () => {
    const a = mock({}), b = mock({});
    await buildReport(a, { range: '7d', compare: false, today: '2026-11-03' });
    await buildReport(b, { range: '7d', compare: true, today: '2026-11-03' });
    expect(b.calls.length).toBe(a.calls.length * 2 - 2); // series (2 queries) run once either way
  });
});

describe('buildLive', () => {
  const nowMs = Date.parse('2026-11-03T10:00:00Z');
  it('maps orders and checkouts of the last half hour with their ages, newest first, no customer names', async () => {
    const gql = mock({
      ql: q => q.includes('TIMESERIES minute') ? table([['minute', 'MINUTE_TIMESTAMP'], ['sessions', 'INTEGER']], [{ minute: '2026-11-03T09:50:00Z', sessions: '2' }, { minute: '2026-11-03T09:10:00Z', sessions: '9' }, { minute: '2026-11-03T09:58:00Z', sessions: '3' }]) : table([['session_city', 'STRING'], ['sessions', 'INTEGER']], [{ session_city: 'Lahore', session_country: 'Pakistan', session_country_code: 'PK', sessions: '4' }]),
      orders: { orders: { nodes: [{ name: '#1042', createdAt: '2026-11-03T09:55:00Z', displayFinancialStatus: 'PAID', sourceName: 'web', currentTotalPriceSet: { shopMoney: { amount: '12500.0', currencyCode: 'PKR' } }, shippingAddress: { city: 'Karachi', countryCodeV2: 'PK' }, lineItems: { nodes: [{ title: 'Ring', quantity: 1 }] } }] } },
      checkouts: { abandonedCheckouts: { nodes: [{ createdAt: '2026-11-03T09:59:00Z', completedAt: null, totalPriceSet: { shopMoney: { amount: '800', currencyCode: 'PKR' } }, shippingAddress: null, lineItems: { nodes: [] } }] } },
    });
    const l = await buildLive(gql, nowMs);
    expect(l.live.sessionsLastHalfHour).toBe(5);
    const recent = (l.sections.recent as any).data;
    expect(recent.map((a: any) => [a.kind, a.ago])).toEqual([['checkout', 60_000], ['order', 300_000]]);
    expect(recent[1]).toMatchObject({ label: '#1042', amount: 12500, currency: 'PKR', place: 'Karachi, PK' });
    expect((l.sections.places as any).data[0]).toMatchObject({ label: 'Lahore, Pakistan', code: 'PK', value: 4 });
  });
  it('falls back to the hour grain when the minute query does not parse', async () => {
    const gql = mock({ ql: q => q.includes('TIMESERIES minute') ? { shopifyqlQuery: { parseErrors: ['no minute'], tableData: null } } : table([['hour', 'HOUR_TIMESTAMP'], ['sessions', 'INTEGER']], [{ hour: '2026-11-03T09:00:00Z', sessions: '7' }]) });
    const l = await buildLive(gql, nowMs);
    expect((l.sections.sessions as any).data).toMatchObject({ grain: 'hour', points: [{ at: '2026-11-03T09:00:00Z', sessions: 7 }] });
    expect(l.live.sessionsLastHalfHour).toBeNull();
  });
  it('names the scope each section lacks', async () => {
    const l = await buildLive(mock({ scopes: ['read_reports'] }), nowMs);
    expect(l.sections.orders).toEqual({ missingScope: 'read_orders' });
    expect(l.sections.recent).toEqual({ missingScope: 'read_orders' });
    expect('data' in l.sections.sessions).toBe(true);
    const m = await buildLive(mock({ scopes: ['read_orders'] }), nowMs);
    expect(m.sections.sessions).toEqual({ missingScope: 'read_reports' });
    expect('data' in m.sections.recent).toBe(true);
  });
});

describe('cache and fetch path', () => {
  it('keeps an answer for its time to live', async () => {
    const make = vi.fn(async () => ({ n: Math.random() }));
    const a = await cached('k', 1000, make, 0), b = await cached('k', 1000, make, 500), c = await cached('k', 1000, make, 1500);
    expect(a).toBe(b); expect(c).not.toBe(a); expect(make).toHaveBeenCalledTimes(2);
  });
  it('sends the query as a variable to shopifyqlQuery', async () => {
    const gql = vi.fn(async (_q: string, _v?: Record<string, unknown>) => table([['sessions', 'INTEGER']], [{ sessions: 1 }]));
    expect(await shopifyql(gql, 'FROM sessions SHOW sessions')).toEqual([{ sessions: 1 }]);
    expect(gql.mock.calls[0][1]).toEqual({ q: 'FROM sessions SHOW sessions' });
  });
});
