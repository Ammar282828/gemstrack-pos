import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The repairs, expenses and hisaab behind the Admin SDK. All names, numbers and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const docs = (c: string, keep: (d: Record<string, unknown>) => boolean = () => true) => ({
  docs: Object.entries(col(c)).filter(([, d]) => keep(d)).map(([id, d]) => ({ id, data: () => d })),
});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      get: async () => docs(c),
      where: (k: string, _op: string, v: unknown) => ({ get: async () => docs(c, (d) => d[k] === v) }),
      doc: (id: string) => ({
        get: async () => ({ exists: !!col(c)[id], id, data: () => col(c)[id] }),
      }),
    }),
  },
  adminAuth: {},
}));
vi.mock('@/lib/karigar-auth', () => ({
  verifyRequestEmail: async (req: NextRequest) => (req.headers.get('authorization') || '').replace(/^Bearer /, '') || null,
}));
vi.mock('@/lib/roles', async (actual) => ({
  ...(await actual<typeof import('@/lib/roles')>()),
  roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'staff@example.com' ? 'staff' : e === 'mkt@example.com' ? 'marketing' : 'none'),
}));
vi.mock('@/lib/reports/monthly-server', () => ({ serverLogo: async () => null }));

const { GET: repairGET } = await import('./repair/[id]/route');
const { GET: expensesGET, POST: expensesPOST } = await import('./expenses/route');
const { GET: summaryGET } = await import('./hisaab/route');
const { GET: ledgerGET } = await import('./hisaab/[id]/route');

const headers = (email: string | null): Record<string, string> => (email ? { authorization: `Bearer ${email}` } : {});
const req = (path: string, email: string | null = 'owner@example.com', init: { method?: string; body?: string } = {}) =>
  new NextRequest(`https://erp.example.com${path}`, { ...init, headers: { 'content-type': 'application/json', ...headers(email) } });
const text = async (res: Response) => new TextDecoder('latin1').decode(await res.arrayBuffer());

const getRepair = (id: string, email: string | null = 'owner@example.com') =>
  repairGET(req(`/api/app/pdf/repair/${encodeURIComponent(id)}`, email), { params: Promise.resolve({ id }) });
const getLedger = (id: string, query = '', email: string | null = 'owner@example.com') =>
  ledgerGET(req(`/api/app/pdf/hisaab/${encodeURIComponent(id)}${query}`, email), { params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  col('repairs')['REP-000001'] = {
    customerName: 'Test Buyer', customerContact: '+923001234567', status: 'received',
    // 01:30 on the 9th in the shop, still the 8th in UTC.
    receivedAt: '2026-10-08T20:30:00.000Z', promisedDate: '2026-10-20',
    pieces: [{ item: 'Test ring', work: 'Resize', weightG: 3.2, price: 2_000 }],
    payments: [{ amount: 500, date: '2026-10-08T20:31:00.000Z', method: 'Cash' }],
    internalNote: 'Owner only: careful',
  };
  col('expenses')['E1'] = { date: '2026-09-30T20:30:00.000Z', amount: 700, category: 'Rent', description: 'Test shop rent' };
  col('expenses')['E2'] = { date: '2026-09-30T18:00:00.000Z', amount: 300, category: 'Tea', description: 'Test chai' };
  col('expenses')['E3'] = { date: '2026-10-02T08:00:00.000Z', amount: 1_200, category: 'Karigar', description: 'Weekly', karigarId: 'K1' };
  col('karigars')['K1'] = { name: 'Test Karigar' };
  col('customers')['C1'] = { name: 'Zara Test' };
  col('hisaab')['H1'] = { entityId: 'C1', entityName: 'Zara Test', entityType: 'customer', date: '2026-10-01T05:00:00.000Z', description: 'Opening', cashDebit: 10_000, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0 };
  col('hisaab')['H2'] = { entityId: 'C1', entityName: 'Zara Test', entityType: 'customer', date: '2026-10-03T05:00:00.000Z', description: 'Paid', cashDebit: 0, cashCredit: 4_000, goldDebitGrams: 0, goldCreditGrams: 0 };
  col('hisaab')['H3'] = { entityId: 'K1', entityName: 'Test Karigar', entityType: 'karigar', date: '2026-10-02T05:00:00.000Z', description: 'Gold in', cashDebit: 0, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 5.5 };
});

describe('/api/app/pdf/repair/[id]', () => {
  it('the receipt Print receipt saves, its days in Karachi', async () => {
    const res = await getRepair('REP-000001');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('filename="Repair-REP-000001.pdf"');
    const t = await text(res);
    expect(t.startsWith('%PDF')).toBe(true);
    expect(t).toContain('Repair #: REP-000001');
    expect(t).toContain('Received: 9 Oct 2026');
    expect(t).toContain('Ready by: 20 Oct 2026');
    expect(t).toContain('Test ring');
    expect(t).not.toContain('Owner only');
  });

  it('owners and staff; no such ticket', async () => {
    expect((await getRepair('REP-000001', 'staff@example.com')).status).toBe(200);
    expect((await getRepair('REP-000001', null)).status).toBe(401);
    expect((await getRepair('REP-000001', 'mkt@example.com')).status).toBe(403);
    expect((await getRepair('REP-404')).status).toBe(404);
    expect((await getRepair('../expenses/E1')).status).toBe(404);
  });
});

describe('/api/app/pdf/expenses', () => {
  it('GET: the report for the filters in the query', async () => {
    const res = await expensesGET(req('/api/app/pdf/expenses?period=custom&start=2026-10-01&end=2026-10-31&grouping=day&category=All&search='));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/filename="Expense-Report-\d{4}-\d{2}-\d{2}\.pdf"/);
    const t = await text(res);
    expect(t).toContain('Expense Report');
    // 01:30 on 1 Oct in the shop is October's; 23:00 on 30 Sep is not.
    expect(t).toContain('Test shop rent');
    expect(t).not.toContain('Test chai');
    expect(t).toContain('Total Expenses: PKR 1,900');
  });

  it("POST: the same, the filters as JSON; the karigar's name is searched", async () => {
    const res = await expensesPOST(req('/api/app/pdf/expenses', 'owner@example.com', {
      method: 'POST', body: JSON.stringify({ period: 'all', grouping: 'month', category: 'All', search: 'test karigar' }),
    }));
    expect(res.status).toBe(200);
    const t = await text(res);
    expect(t).toContain('Weekly');
    expect(t).not.toContain('Test shop rent');
    expect(t).toContain('Total Expenses: PKR 1,200');
  });

  it('owners only', async () => {
    expect((await expensesGET(req('/api/app/pdf/expenses', 'staff@example.com'))).status).toBe(403);
    expect((await expensesGET(req('/api/app/pdf/expenses', null))).status).toBe(401);
  });
});

describe('/api/app/pdf/hisaab', () => {
  it('the summary, and ?q= as the page searches', async () => {
    const all = await text(await summaryGET(req('/api/app/pdf/hisaab')));
    expect(all).toContain('Hisaab Summary Report');
    expect(all).toContain('Zara Test');
    expect(all).toContain('Test Karigar');
    const one = await text(await summaryGET(req('/api/app/pdf/hisaab?q=zara')));
    expect(one).toContain('Zara Test');
    expect(one).not.toContain('Test Karigar');
  });

  it('owners only', async () => {
    expect((await summaryGET(req('/api/app/pdf/hisaab', 'staff@example.com'))).status).toBe(403);
  });
});

describe('/api/app/pdf/hisaab/[id]', () => {
  it("one person's statement, named for them", async () => {
    const res = await getLedger('C1', '?type=customer');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/filename="Ledger-Zara Test-\d{4}-\d{2}-\d{2}\.pdf"/);
    const t = await text(res);
    expect(t).toContain('Ledger Statement');
    expect(t).toContain('Receivable: PKR 6,000');
    expect(t).toContain('\\(customer\\)');
  });

  it('a karigar, his type from his rows', async () => {
    const t = await text(await getLedger('K1'));
    expect(t).toContain('Test Karigar');
    expect(t).toContain('\\(karigar\\)');
  });

  it('nobody; owners only', async () => {
    expect((await getLedger('NOPE', '?type=customer')).status).toBe(404);
    expect((await getLedger('C1', '', 'staff@example.com')).status).toBe(403);
  });
});
