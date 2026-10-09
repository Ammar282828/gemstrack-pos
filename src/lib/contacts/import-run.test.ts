import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { Customer, Karigar } from '@/lib/store';
import { planImport, toExistingRows, type ImportPlan } from './triage';
import { checkChoices, contactImportSteps, planFingerprint, runContactImport } from './import-run';
import { gather } from '@/lib/writes/gathered';
import { customerIdMaker } from '@/lib/writes/new-customer';

// A made-up address book and a made-up shop book.
const vcf = [
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Demo Fresh TJ', 'TEL;type=CELL:0300 1110001', 'TEL:0300 1110009', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Demo Same HOM', 'TEL:0300 1110002', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Demo Longer Name TC', 'TEL:0300 1110003', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Demo Settled TJ', 'TEL:0300 1110004', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:Ustad New Karigar', 'TEL:0300 1110005', 'END:VCARD',
  'BEGIN:VCARD', 'VERSION:3.0', 'FN:A Personal Friend', 'TEL:0300 1110006', 'END:VCARD',
].join('\n');

const customers = [
  { id: 'cust-1', name: 'Demo Same', phone: '+923009990002' },
  { id: 'cust-2', name: 'Demo Longer', phone: '+923001110003' },
  { id: 'cust-3', name: 'Demo Settled', phone: '+923001110004' },
] as Customer[];
const karigars = [] as Karigar[];

const plan = (): ImportPlan => planImport(vcf, toExistingRows(customers, karigars));

describe('the plan the steps start from', () => {
  it('has one new customer, one new karigar, two half-matches and one settled', () => {
    const p = plan();
    expect(p.fresh.map((f) => [f.name, f.kind])).toEqual([['Demo Fresh', 'customer'], ['Ustad New', 'karigar']]);
    expect(p.conflicts.map((c) => [c.name, c.reason])).toEqual([['Demo Same', 'same_name'], ['Demo Longer Name', 'same_phone']]);
    expect(p.settled).toHaveLength(1);
    expect(p.summary.ignoredUntagged).toBe(1);
  });
});

describe('contactImportSteps', () => {
  it('adds the new ones not dropped, then answers each half-match as the page does', () => {
    const p = plan();
    const [same, longer] = p.conflicts;
    const steps = contactImportSteps(p, [p.fresh[1].id], { [same.id]: 'add_phone', [longer.id]: 'adopt_name' });
    expect(steps).toEqual([
      { kind: 'create', contact: p.fresh[0] },
      { kind: 'addPhone', target: same.matches[0], phone: '0300 1110002' },
      { kind: 'adoptName', target: longer.matches[0], name: 'Demo Longer Name' },
    ]);
  });

  it('adds a half-match separately when told they are different people, and leaves alone one not answered', () => {
    const p = plan();
    const [same, longer] = p.conflicts;
    const steps = contactImportSteps(p, p.fresh.map((f) => f.id), { [same.id]: 'add_separately' });
    expect(steps).toEqual([{ kind: 'create', contact: same }]);
    expect(contactImportSteps(p, p.fresh.map((f) => f.id), { [same.id]: 'skip', [longer.id]: 'skip' })).toEqual([]);
  });
});

describe('checkChoices', () => {
  it('takes only the answers each half-match offers', () => {
    const p = plan();
    const [same, longer] = p.conflicts;
    expect(checkChoices(p, { [same.id]: 'add_phone', [longer.id]: 'skip' })).toEqual({ ok: true, choices: { [same.id]: 'add_phone', [longer.id]: 'skip' } });
    expect(checkChoices(p, undefined)).toEqual({ ok: true, choices: {} });
    expect(checkChoices(p, { [same.id]: 'adopt_name' }).ok).toBe(false);
    expect(checkChoices(p, { [longer.id]: 'add_phone' }).ok).toBe(false);
    expect(checkChoices(p, { v99: 'skip' }).ok).toBe(false);
    expect(checkChoices(p, ['skip']).ok).toBe(false);
  });
});

describe('planFingerprint', () => {
  it('is the same for the same file against the same book', () => {
    expect(planFingerprint(plan())).toBe(planFingerprint(plan()));
    expect(planFingerprint(plan())).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when the book has moved under a half-match, or a new customer has arrived', () => {
    const before = planFingerprint(plan());
    const renamed = planImport(vcf, toExistingRows([{ ...customers[0], phone: '+923009990099' }, ...customers.slice(1)], karigars));
    expect(planFingerprint(renamed)).not.toBe(before);
    const added = planImport(vcf, toExistingRows([...customers, { id: 'cust-9', name: 'Demo Fresh', phone: '+923001110001' } as Customer], karigars));
    expect(planFingerprint(added)).not.toBe(before);
  });
});

// One in-memory database behind the port.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };
let commits = 0;
const port: DbPort = {
  async runTransaction(fn) {
    const tx: TxCtx = {
      async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
      set(c, id, d, merge) { put(c, id, d, merge); },
      update(c, id, d) { put(c, id, d, true); },
      delete(c, id) { delete col(c)[id]; },
    };
    return fn(tx);
  },
  async queryEquals() { return []; },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add() { return 'x'; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { commits++; writes.forEach((w) => w()); },
    };
  },
  newId: () => 'n1',
  timestamp: (d) => d.toISOString(),
  serverTime: () => 'now',
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  commits = 0;
  for (const c of customers) put('customers', c.id, { ...c });
});

describe('runContactImport, gathered', () => {
  it('writes each step as the store does, in one batch, and logs each once it has landed', async () => {
    const p = plan();
    const [same, longer] = p.conflicts;
    const steps = contactImportSteps(p, [], { [same.id]: 'add_phone', [longer.id]: 'adopt_name' });
    const logged: string[] = [];
    const held = gather(port, (a, t) => { logged.push(`${a} ${t}`); });
    const out = await runContactImport(held.port, steps, { newCustomerId: customerIdMaker(['cust-1000'], () => 1000) }, held.fx);
    expect(commits).toBe(0);
    expect(logged).toEqual([]);
    expect(await held.commit()).toEqual({ landed: 4 });
    expect(commits).toBe(1);

    expect(out).toEqual({ added: 2, updated: 2 });
    // The store's new customer: the number in E.164, an empty email and address, and nothing else.
    expect(col('customers')['cust-1001']).toEqual({ id: 'cust-1001', name: 'Demo Fresh', phone: '+923001110001', email: '', address: '' });
    const karigar = Object.values(col('karigars'))[0];
    expect(karigar).toMatchObject({ name: 'Ustad New', contact: '0300 1110005' });
    expect(String(karigar.id)).toMatch(/^karigar-\d+-[a-z0-9]+$/);
    // The second number goes in the spare slot; the one on file stays.
    expect(col('customers')['cust-1']).toEqual({ id: 'cust-1', name: 'Demo Same', phone: '+923009990002', altPhone: '0300 1110002' });
    expect(col('customers')['cust-2'].name).toBe('Demo Longer Name');
    expect(logged).toEqual([
      'customer.create Created customer: Demo Fresh',
      'karigar.create Created karigar: Ustad New',
      'customer.update Updated customer: cust-1',
      'customer.update Updated customer: Demo Longer Name',
    ]);
  });
});

describe('gather', () => {
  it('sends the writes in batches of the size asked, a write\'s log after its batch', async () => {
    const order: string[] = [];
    const held = gather({ ...port, batch: () => { const b = port.batch(); return { ...b, commit: async () => { order.push('commit'); await b.commit(); } }; } },
      (a) => { order.push(a); }, 2);
    for (let i = 0; i < 5; i++) {
      const b = held.port.batch();
      b.set('things', `t${i}`, { n: i });
      await b.commit();
      await held.fx.log?.(`log${i}`, '', '');
    }
    expect(await held.commit()).toEqual({ landed: 5 });
    expect(order).toEqual(['commit', 'log0', 'log1', 'commit', 'log2', 'log3', 'commit', 'log4']);
    expect(Object.keys(col('things'))).toHaveLength(5);
  });

  it('refuses a transaction or a direct write rather than going round the batch', async () => {
    const held = gather(port);
    await expect(async () => held.port.runTransaction(async () => 1)).rejects.toThrow(/cannot be gathered/);
    await expect(async () => held.port.update('x', 'y', {})).rejects.toThrow(/cannot be gathered/);
  });
});

describe('customerIdMaker', () => {
  it('makes store-shaped ids a millisecond apart, never one on file', () => {
    const next = customerIdMaker(['cust-500', 'cust-501'], () => 500);
    expect([next(), next(), next()]).toEqual(['cust-502', 'cust-503', 'cust-504']);
  });
});
