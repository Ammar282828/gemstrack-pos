import { describe, expect, it, vi } from 'vitest';
import { classicRaw, pickArg, runSteps, stepsFrom, undoAll, viewStep, type ViewCtx } from './steps';
import { COMMANDS, commandLines } from './commands';
import type { Book } from './args';
import type { RunCtx } from './commands';

const book: Book = {
  roster: [
    { id: 'c1', name: 'Rashida Modi', kind: 'customer' },
    { id: 'k1', name: 'Ahsan Meena', kind: 'karigar' },
    { id: 'k2', name: 'Ahsan Box', kind: 'karigar' },
    { id: 'k3', name: 'Uzair', kind: 'karigar' },
  ],
  aliases: new Map(), customers: [], karigars: [],
  orders: [{ id: 'ORD-000041', customerId: 'c1', customerName: 'Rashida Modi', status: 'Pending', subtotal: 300000, advancePayment: 30000, grandTotal: 270000,
    items: [{ description: 'Kada', karigarId: '' }, { description: 'Ring', karigarId: '' }], createdAt: '2026-09-30' }] as never,
  invoices: [], repairs: [], products: [], givenItems: [], karigarJobs: [], expenses: [], extraRevenues: [],
  destinations: [{ label: 'Analytics', href: '/analytics', keywords: [] }],
  today: '2026-10-01',
};
const ctx: ViewCtx = { book, documents: [] };
const ask = (raw: Parameters<typeof stepsFrom>[0]) => stepsFrom(raw).steps;

const fakeStore = () => {
  const s = {
    settings: { goldRatePerGram21k: 35000 },
    orders: book.orders, generatedInvoices: [], repairs: [], products: [], hisaabEntries: [],
    updateSettings: vi.fn(async () => {}),
    updateOrderItemKarigar: vi.fn(async () => {}),
    assignOrderItemsToKarigar: vi.fn(async () => {}),
    updateOrder: vi.fn(async () => {}),
    addCustomer: vi.fn(async (c: { name: string }) => ({ id: 'c9', ...c })),
    deleteCustomer: vi.fn(async () => {}),
  };
  const go = vi.fn();
  const handOff = vi.fn();
  const x: RunCtx = { s: s as never, go, handOff, now: '2026-10-01T10:00:00Z' };
  return { s, x, go, handOff };
};

describe('the catalogue', () => {
  it('every command has a unique id, a line for the model and a sentence for the card', () => {
    expect(new Set(COMMANDS.map(c => c.id)).size).toBe(COMMANDS.length);
    expect(commandLines()).toHaveLength(COMMANDS.length);
    expect(commandLines().every(l => !l.includes(" | "))).toBe(true);
    for (const c of COMMANDS) expect(() => c.describe({})).not.toThrow();
  });
});

describe('stepsFrom', () => {
  it('reads khata entries, commands and lists of pieces; drops what is not on the list', () => {
    const { steps, dropped } = stepsFrom([
      { command: 'invoice_payment', args: [{ name: 'person', value: 'Rashida' }, { name: 'amount', value: '20000' }, { name: 'method', value: 'bank' }] },
      { command: 'new_order', args: [{ name: 'customer', value: 'Rashida' }, { name: 'piece', value: 'kangan' }, { name: 'karat', value: '21k' }, { name: 'weight', value: '20' }, { name: 'piece', value: 'ring' }, { name: 'weight', value: '4.5' }, { name: 'advance', value: '30000' }] },
      { command: 'launch_rocket', args: [] },
      { command: 'navigate', args: [{ name: 'screen', value: 'analytics' }] },
    ]);
    expect(dropped).toEqual(['launch_rocket']);
    expect(steps.map(s => s.kind === 'classic' ? s.draft.raw.action : s.command)).toEqual(['invoice_payment', 'new_order', 'go']);
    const order = steps[1];
    expect(order.kind === 'command' && order.pieces).toEqual([{ piece: 'kangan', karat: '21k', weight: '20' }, { piece: 'ring', weight: '4.5' }]);
    expect(order.kind === 'command' && order.args).toEqual({ customer: 'Rashida', advance: '30000' });
  });

  it('a khata step carries its figures, the order number and the fields', () => {
    expect(classicRaw('order_status', [{ name: 'order', value: '41' }, { name: 'status', value: 'Completed' }]))
      .toMatchObject({ action: 'order_status', doc: { kind: 'order', id: '41' }, fields: { status: 'Completed' } });
    expect(classicRaw('record_payout', [{ name: 'person', value: 'Uzair' }, { name: 'amount', value: '5,000' }]))
      .toMatchObject({ person: { name: 'Uzair' }, amount: 5000 });
  });
});

describe('viewStep', () => {
  it('a rate is ready and says what it will do', () => {
    const [s] = ask([{ command: 'set_rate', args: [{ name: 'metal', value: '21k' }, { name: 'rate', value: '34000' }] }]);
    const v = viewStep(s, ctx);
    expect(v.ready).toBe(true);
    expect(v.summary).toBe('Set the 21k rate to Rs 34,000 a gram.');
  });
  it('a figure not heard is asked for, not invented', () => {
    const [s] = ask([{ command: 'set_rate', args: [{ name: 'metal', value: '21k' }] }]);
    expect(viewStep(s, ctx)).toMatchObject({ ready: false, problem: 'Per gram?' });
  });
  it('"which Ahsan?" waits for the card, and the choice makes it ready', () => {
    const [s] = ask([{ command: 'order_assign', args: [{ name: 'order', value: '41' }, { name: 'karigar', value: 'Ahsan' }] }]);
    const v = viewStep(s, ctx);
    expect(v.ready).toBe(false);
    const k = v.args.find(a => a.spec.name === 'karigar')!;
    expect(k.r && !k.r.ok && k.r.candidates.map(c => c.label)).toEqual(expect.arrayContaining(['Ahsan Meena', 'Ahsan Box']));
    const picked = pickArg(s, 'karigar', (k.r as { candidates: { label: string }[] }).candidates.find(c => c.label === 'Ahsan Meena') as never);
    const after = viewStep(picked, ctx);
    expect(after.ready).toBe(true);
    expect(after.summary).toBe('Give every piece of ORD-000041 to Ahsan Meena.');
  });
});

describe('runSteps', () => {
  it('does each step with the store action a page would call', async () => {
    const { s, x } = fakeStore();
    const steps = ask([
      { command: 'set_rate', args: [{ name: 'metal', value: '21k' }, { name: 'rate', value: '34000' }] },
      { command: 'order_assign', args: [{ name: 'order', value: '41' }, { name: 'karigar', value: 'Uzair' }, { name: 'piece', value: '2' }] },
    ]);
    const r = await runSteps(steps, ctx, x);
    expect(r.error).toBeNull();
    expect(s.updateSettings).toHaveBeenCalledWith({ goldRatePerGram21k: 34000 }, { source: 'voice' });
    expect(s.updateOrderItemKarigar).toHaveBeenCalledWith('ORD-000041', 1, 'k3');
    // Undo takes them back, last first.
    await undoAll(r.done)!();
    expect(s.updateOrderItemKarigar).toHaveBeenLastCalledWith('ORD-000041', 1, '');
    expect(s.updateSettings).toHaveBeenLastCalledWith({ goldRatePerGram21k: 35000 }, { source: 'voice undo' });
  });

  it('"$1" is what step 1 made: a new customer, then her order', async () => {
    const { x, handOff, go } = fakeStore();
    const steps = ask([
      { command: 'new_customer', args: [{ name: 'name', value: 'Sara' }, { name: 'phone', value: '03001234567' }] },
      { command: 'new_order', args: [{ name: 'customer', value: '$1' }, { name: 'piece', value: 'ring' }, { name: 'karat', value: '21k' }, { name: 'weight', value: '5' }] },
    ]);
    expect(steps.map(s => viewStep(s, ctx).ready)).toEqual([true, true]);
    const r = await runSteps(steps, ctx, x);
    expect(r.error).toBeNull();
    const [kind, draft] = handOff.mock.calls[0];
    expect(kind).toBe('order');
    expect(draft.customer.pinned).toMatchObject({ id: 'c9', name: 'Sara' });
    expect(draft.items).toEqual([expect.objectContaining({ description: 'ring', karat: 21, weightG: 5 })]);
    expect(go).toHaveBeenCalledWith('/orders/add?voice=1');
  });

  it('stops at a step that fails, with what was done before it kept', async () => {
    const { s, x } = fakeStore();
    s.updateOrder.mockRejectedValueOnce(new Error('The database is locked.'));
    const steps = ask([
      { command: 'set_rate', args: [{ name: 'metal', value: '22k' }, { name: 'rate', value: '36000' }] },
      { command: 'order_discount', args: [{ name: 'order', value: '41' }, { name: 'amount', value: '5000' }] },
      { command: 'set_rate', args: [{ name: 'metal', value: '24k' }, { name: 'rate', value: '39000' }] },
    ]);
    const r = await runSteps(steps, ctx, x);
    expect(r.failedAt).toBe(1);
    expect(r.error).toBe('The database is locked.');
    expect(r.done).toHaveLength(1);
    expect(s.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('works out an order discount’s new balance', async () => {
    const { s, x } = fakeStore();
    await runSteps(ask([{ command: 'order_discount', args: [{ name: 'order', value: '41' }, { name: 'amount', value: '5000' }] }]), ctx, x);
    expect(s.updateOrder).toHaveBeenCalledWith('ORD-000041', { discountAmount: 5000, grandTotal: 265000 });
  });
});

describe('parseStepLine', () => {
  it('reads the one-line step the model writes', () => {
    expect(stepsFrom(['set_rate | metal=21k | rate=34000', 'new_order | customer=$1 | piece=ring | karat=21k | weight=5', 'go | screen="Analytics"']).steps.map(s => s.kind === 'command' ? [s.command, s.args, s.pieces] : null))
      .toEqual([
        ['set_rate', { metal: '21k', rate: '34000' }, []],
        ['new_order', { customer: '$1' }, [{ piece: 'ring', karat: '21k', weight: '5' }]],
        ['go', { screen: 'Analytics' }, []],
      ]);
  });
});
