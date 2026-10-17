import { describe, expect, it } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import type { Customer, Karigar } from '@/lib/store';
import { planBookImport, type TaheriBook } from '@/lib/import/taheri-book';
import { customerIdMaker } from './new-customer';
import { bookHalfMatches, bookImportRows, bookPlanFingerprint, bookWillAdd, ledgerCounts, runBookImport } from './taheri-book-import';

// An in-memory database behind the port, batches only, as an import writes. All names and numbers made up.
function fakeDb() {
  const data: Record<string, Record<string, Record<string, unknown>>> = {};
  const col = (c: string) => (data[c] ??= {});
  const db = {
    async get(c: string, id: string) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    batch() {
      const writes: (() => void)[] = [];
      return {
        set(c: string, id: string, d: Record<string, unknown>) { writes.push(() => { col(c)[id] = { ...d }; }); },
        update() {},
        delete() {},
        async commit() { writes.forEach((w) => w()); },
      };
    },
  } as unknown as DbPort;
  return { db, data };
}

const BOOK: TaheriBook = {
  source: 'demo.db',
  customers: [
    { name: 'Demo New', phone: '0300 1110001', country: 'Pakistan', tags: ['tj'] },
    { name: 'Demo Settled', phone: '+923001110002' },
    { name: 'Demo SameName', phone: '+923001119999' },
    { name: 'Demo Other Name', phone: '03001110004' },
  ],
  karigars: [
    { name: 'Test Karigar', contact: '03001110005', specialty: 'setting', country: 'Pakistan' },
    { name: 'Test Bench', contact: '03001110006' },
  ],
};

const CUSTOMERS = [
  { id: 'cust-1', name: 'Demo Settled', phone: '+923001110002' },
  { id: 'cust-2', name: 'Demo SameName', phone: '+923001110003' },
  { id: 'cust-3', name: 'Demo Phone Owner', phone: '+923001110004' },
] as Customer[];
const KARIGARS = [{ id: 'kar-1', name: 'Test Bench', contact: '+923001110006' }] as Karigar[];

describe('the Taheri book import', () => {
  const plan = planBookImport(BOOK, CUSTOMERS, KARIGARS);

  it('adds the new rows only, unless the half-matches are asked for too', () => {
    expect(bookImportRows(plan.customers, false).map((r) => r.incoming.name)).toEqual(['Demo New']);
    expect(bookImportRows(plan.customers, true).map((r) => r.incoming.name)).toEqual(['Demo New', 'Demo SameName', 'Demo Other Name']);
    // The settled are never added, either way.
    expect(bookWillAdd(plan, false)).toBe(2);
    expect(bookWillAdd(plan, true)).toBe(4);
  });

  it('lists each half-match with whom it collided and the ledger they carry', () => {
    const ledger = ledgerCounts(['cust-2', 'cust-2', 'cust-3', undefined, '']);
    expect(ledger.get('cust-2')).toBe(2);
    expect(bookHalfMatches(plan, ledger)).toEqual([
      { id: 'c2', kind: 'customer', name: 'Demo SameName', verdict: 'same_name', matches: ['Demo SameName'], carried: 2 },
      { id: 'c3', kind: 'customer', name: 'Demo Other Name', verdict: 'same_phone', matches: ['Demo Phone Owner'], carried: 1 },
    ]);
  });

  it('fingerprints the plan, so a book changed meanwhile is told apart', () => {
    const same = planBookImport(BOOK, CUSTOMERS, KARIGARS);
    expect(bookPlanFingerprint(same)).toBe(bookPlanFingerprint(plan));
    const added = planBookImport(BOOK, [...CUSTOMERS, { id: 'cust-4', name: 'Demo New', phone: '+923001110001' } as Customer], KARIGARS);
    expect(bookPlanFingerprint(added)).not.toBe(bookPlanFingerprint(plan));
  });

  it('writes each row as the store does: a customer by name and number, a karigar whole', async () => {
    const { db, data } = fakeDb();
    const lines: string[] = [];
    const out = await runBookImport(db, plan, false, { newCustomerId: customerIdMaker(['cust-1'], () => 1000) }, {
      log: (a, t) => { lines.push(`${a} ${t}`); },
    });
    expect(out).toEqual({ customers: 1, karigars: 1 });
    expect(data.customers['cust-1000']).toEqual({ id: 'cust-1000', name: 'Demo New', phone: '+923001110001', email: '', address: '' });
    const [karigar] = Object.values(data.karigars);
    expect(karigar).toMatchObject({ name: 'Test Karigar', contact: '03001110005', specialty: 'setting', country: 'Pakistan' });
    expect(lines).toEqual(['customer.create Created customer: Demo New', 'karigar.create Created karigar: Test Karigar']);
  });

  it('adds nobody when run again: they all count as already here', () => {
    const after = planBookImport(BOOK, [...CUSTOMERS, { id: 'cust-1000', name: 'Demo New', phone: '+923001110001' } as Customer],
      [...KARIGARS, { id: 'kar-2', name: 'Test Karigar', contact: '03001110005' } as Karigar]);
    expect(bookWillAdd(after, false)).toBe(0);
  });
});
