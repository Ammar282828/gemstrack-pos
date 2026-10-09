import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { addKarigar, cleanCustomerEdit, cleanKarigarEdit, isIsoDay, updateCustomer, updateKarigar } from './people';

// An in-memory database behind the port, as repairs.test.ts has it. All names, numbers and addresses made up.
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  const apply = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };
  const db: DbPort = {
    async runTransaction(fn) {
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => apply(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => apply(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    },
    async queryEquals() { return []; },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { apply(c, id, d, true); },
    batch() {
      const writes: (() => void)[] = [];
      return {
        set(c, id, d, merge) { writes.push(() => apply(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => apply(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
        async commit() { writes.forEach((w) => w()); },
      };
    },
    newId() { return 'n1'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

const logger = () => {
  const lines: string[][] = [];
  return { lines, fx: { log: (a: string, t: string, d: string, id?: string) => { lines.push([a, t, d, id ?? '']); } } };
};

const CUSTOMER = { id: 'cust-1', name: 'Demo Customer', phone: '+923001110000', email: 'demo@example.com', address: '1 Test Street', ringSize: '12', tags: ['tj'], shopifyCustomerId: 'sh-1' };

describe('updateCustomer', () => {
  it('merges the fields given and keeps every other field on the document', async () => {
    const { db, data } = fakeDb({ customers: { 'cust-1': { ...CUSTOMER } } });
    const { fx, lines } = logger();
    await updateCustomer(db, 'cust-1', { name: 'Demo Renamed', city: 'Testville' }, fx);
    expect(data.customers['cust-1']).toEqual({ ...CUSTOMER, name: 'Demo Renamed', city: 'Testville' });
    expect(lines).toEqual([['customer.update', 'Updated customer: Demo Renamed', 'ID: cust-1', 'cust-1']]);
  });

  it('makes the number E.164 on every save, as the store always has', async () => {
    const { db, data } = fakeDb({ customers: { 'cust-1': { ...CUSTOMER } } });
    await updateCustomer(db, 'cust-1', { phone: '0300 222-3333' });
    expect(data.customers['cust-1'].phone).toBe('+923002223333');
  });

  it('does not touch any other document: a rename leaves the invoices as they were written', async () => {
    const { db, data } = fakeDb({
      customers: { 'cust-1': { ...CUSTOMER } },
      invoices: { 'INV-1': { customerId: 'cust-1', customerName: 'Demo Customer' } },
      hisaab: { h1: { entityId: 'cust-1', entityName: 'Demo Customer' } },
    });
    await updateCustomer(db, 'cust-1', { name: 'Demo Renamed' });
    expect(data.invoices['INV-1'].customerName).toBe('Demo Customer');
    expect(data.hisaab.h1.entityName).toBe('Demo Customer');
  });

  it('drops an undefined field rather than failing the whole save', async () => {
    const { db, data } = fakeDb({ customers: { 'cust-1': { ...CUSTOMER } } });
    await updateCustomer(db, 'cust-1', { name: 'Demo Two', source: undefined });
    expect(data.customers['cust-1'].name).toBe('Demo Two');
    expect('source' in data.customers['cust-1']).toBe(false);
  });

  it('mustExist refuses a customer who is not on file or has been removed, and writes nothing', async () => {
    const { db, data } = fakeDb({ customers: { gone: { id: 'gone', name: 'Old', deletedAt: '2026-10-01T00:00:00.000Z' } } });
    await expect(updateCustomer(db, 'nobody', { name: 'x' }, {}, { mustExist: true })).rejects.toThrow(/No such customer/);
    await expect(updateCustomer(db, 'gone', { name: 'x' }, {}, { mustExist: true })).rejects.toThrow(/No such customer/);
    expect(data.customers.nobody).toBeUndefined();
    expect(data.customers.gone.name).toBe('Old');
  });

  it('without mustExist it writes as the store does (the browser makes the document if it must)', async () => {
    const { db, data } = fakeDb({});
    await updateCustomer(db, 'cust-9', { name: 'Demo Nine' });
    expect(data.customers['cust-9']).toEqual({ name: 'Demo Nine' });
  });
});

describe('cleanCustomerEdit', () => {
  const ok = (input: unknown) => {
    const r = cleanCustomerEdit(input);
    if (!r.ok) throw new Error(r.error);
    return r.patch;
  };

  it('keeps only the fields the customer form edits, trimmed', () => {
    const patch = ok({
      name: '  Demo Customer ', phone: '03001234567', altPhone: '0321 1234567', email: ' demo@example.com ', address: ' 2 Test Road ',
      city: 'Testville', country: 'Nowhere', source: 'referral',
      ringSize: ' 12.5 ', bangleSize: '2.6', braceletSize: '7 in', chainLength: '18 in',
      birthday: '1990-06-30', anniversary: '2015-02-14', preference: ' no rose gold ', notes: ' likes heavier sets ',
      // Not the form's: never written from the phone.
      id: 'other', deletedAt: '2026-01-01', tags: ['x'], shopifyCustomerId: 'sh-9', balance: 99,
    });
    expect(patch).toEqual({
      name: 'Demo Customer', phone: '+923001234567', altPhone: '+923211234567', email: 'demo@example.com', address: '2 Test Road',
      city: 'Testville', country: 'Nowhere', source: 'referral',
      ringSize: '12.5', bangleSize: '2.6', braceletSize: '7 in', chainLength: '18 in',
      birthday: '1990-06-30', anniversary: '2015-02-14', preference: 'no rose gold', notes: 'likes heavier sets',
    });
  });

  it('leaves out what was not sent, and keeps a field sent blank as blank (a cleared box clears the field)', () => {
    expect(ok({ name: 'Demo', notes: '' })).toEqual({ name: 'Demo', notes: '' });
  });

  it('names a nameless customer as the form does', () => {
    expect(ok({ name: '  ', phone: '0300 1234567' }).name).toBe('Customer - +923001234567');
    expect(ok({ name: '', phone: '' }).name).toBe('Unnamed Customer');
    expect(ok({ name: '' }).name).toBe('Unnamed Customer');
  });

  it('refuses what the form refuses, and says why', () => {
    expect(cleanCustomerEdit({ email: 'not an email' })).toEqual({ ok: false, error: 'Invalid email address' });
    expect(cleanCustomerEdit({ source: 'friend' }).ok).toBe(false);
    expect(cleanCustomerEdit({ birthday: '30/06/1990' }).ok).toBe(false);
    expect(cleanCustomerEdit({ anniversary: '2015-02-30' }).ok).toBe(false);
    expect(cleanCustomerEdit({ ringSize: 12 })).toEqual({ ok: false, error: 'Ring size must be text.' });
    expect(cleanCustomerEdit({ notes: 'x'.repeat(4001) })).toEqual({ ok: false, error: 'Notes is too long.' });
  });

  it('has nothing to save from nothing, or from only fields that are not the form\'s', () => {
    expect(cleanCustomerEdit(undefined).ok).toBe(false);
    expect(cleanCustomerEdit([]).ok).toBe(false);
    expect(cleanCustomerEdit({}).ok).toBe(false);
    expect(cleanCustomerEdit({ deletedAt: '2026-01-01', id: 'x' })).toEqual({ ok: false, error: 'Nothing to save.' });
  });

  it('takes a source off with a blank, and refuses one the shop does not have', () => {
    expect(ok({ source: '' })).toEqual({ source: '' });
    for (const s of ['taheri_spillover', 'referral', 'walkin', 'social_media', 'website', 'other']) expect(ok({ source: s })).toEqual({ source: s });
  });
});

describe('isIsoDay', () => {
  it('is a date input\'s value and a day the calendar has', () => {
    expect(isIsoDay('2024-02-29')).toBe(true);
    expect(isIsoDay('2023-02-29')).toBe(false);
    expect(isIsoDay('2023-13-01')).toBe(false);
    expect(isIsoDay('1990-6-3')).toBe(false);
    expect(isIsoDay('')).toBe(false);
  });
});

describe('karigars', () => {
  it('adds a karigar under a generated id with exactly the fields given, and logs it', async () => {
    const { db, data } = fakeDb({});
    const { fx, lines } = logger();
    const k = await addKarigar(db, { name: 'Ustad Demo', contact: '+923001110000', specialty: 'setting' }, fx, { id: 'karigar-t1' });
    expect(k).toEqual({ id: 'karigar-t1', name: 'Ustad Demo', contact: '+923001110000', specialty: 'setting' });
    expect(data.karigars['karigar-t1']).toEqual(k);
    expect(lines).toEqual([['karigar.create', 'Created karigar: Ustad Demo', 'ID: karigar-t1', 'karigar-t1']]);
  });

  it('makes its id as the store did', async () => {
    const { db } = fakeDb({});
    const k = await addKarigar(db, { name: 'Ustad Demo' });
    expect(k.id).toMatch(/^karigar-\d+-[a-z0-9]{1,5}$/);
  });

  it('updates by merging, and keeps the rest of the document', async () => {
    const { db, data } = fakeDb({ karigars: { k1: { id: 'k1', name: 'Ustad Demo', city: 'Testville', email: 'k@example.com' } } });
    const { fx, lines } = logger();
    await updateKarigar(db, 'k1', { name: 'Ustad Renamed', notes: 'Fridays off' }, fx);
    expect(data.karigars.k1).toEqual({ id: 'k1', name: 'Ustad Renamed', city: 'Testville', email: 'k@example.com', notes: 'Fridays off' });
    expect(lines).toEqual([['karigar.update', 'Updated karigar: Ustad Renamed', 'ID: k1', 'k1']]);
  });

  it('mustExist refuses a karigar who is not on file or has been removed', async () => {
    const { db } = fakeDb({ karigars: { k2: { id: 'k2', name: 'Old', deletedAt: '2026-10-01T00:00:00.000Z' } } });
    await expect(updateKarigar(db, 'nobody', { name: 'x' }, {}, { mustExist: true })).rejects.toThrow(/No such karigar/);
    await expect(updateKarigar(db, 'k2', { name: 'x' }, {}, { mustExist: true })).rejects.toThrow(/No such karigar/);
  });
});

describe('cleanKarigarEdit', () => {
  const ok = (input: unknown, mode: 'add' | 'update') => {
    const r = cleanKarigarEdit(input, mode);
    if (!r.ok) throw new Error(r.error);
    return r.patch;
  };

  it('keeps only the karigar form\'s fields; the login email is lowercase, the contact E.164, the second number as typed', () => {
    expect(ok({
      name: ' Ustad Demo ', contact: '0300 1110000', altPhone: ' workshop line 021-555 ', email: ' Demo.K@Example.COM ',
      specialty: ' meena ', workshop: ' Bench 4 ', address: ' 3 Test Lane ', city: 'Testville', country: 'Nowhere', notes: ' ok ',
      id: 'x', deletedAt: 'y', hisaab: 5,
    }, 'add')).toEqual({
      name: 'Ustad Demo', contact: '+923001110000', altPhone: 'workshop line 021-555', email: 'demo.k@example.com',
      specialty: 'meena', workshop: 'Bench 4', address: '3 Test Lane', city: 'Testville', country: 'Nowhere', notes: 'ok',
    });
  });

  it('a new karigar needs a name; an edit may leave the name out but not blank it', () => {
    expect(cleanKarigarEdit({ city: 'Testville' }, 'add')).toEqual({ ok: false, error: 'Name is required' });
    expect(cleanKarigarEdit({ name: '  ' }, 'add')).toEqual({ ok: false, error: 'Name is required' });
    expect(cleanKarigarEdit({ name: '' }, 'update')).toEqual({ ok: false, error: 'Name is required' });
    expect(ok({ city: 'Testville' }, 'update')).toEqual({ city: 'Testville' });
  });

  it('refuses a login email that is not one, but lets it be cleared', () => {
    expect(cleanKarigarEdit({ name: 'Demo', email: 'nope' }, 'add')).toEqual({ ok: false, error: 'Enter a valid email' });
    expect(ok({ email: '' }, 'update')).toEqual({ email: '' });
  });

  it('has nothing to save from nothing', () => {
    expect(cleanKarigarEdit(null, 'update').ok).toBe(false);
    expect(cleanKarigarEdit({ id: 'x' }, 'update')).toEqual({ ok: false, error: 'Nothing to save.' });
    expect(cleanKarigarEdit({ name: 7 }, 'add')).toEqual({ ok: false, error: 'Name must be text.' });
  });
});
