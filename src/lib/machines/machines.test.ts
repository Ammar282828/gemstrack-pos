import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertMove, check, movesFrom, MoveRefused } from './machine';
import { BOOKING, LINK, MACHINES, ONLINE, ORDER, REPAIR } from './index';
import { machinesJsonText, machinesMarkdown } from './export';

describe('the exports are current (npm run machines:export)', () => {
  it('machines.json for the apps', () => expect(fs.readFileSync('apps/iphone/App/Resources/machines.json', 'utf8')).toBe(machinesJsonText()));
  it('docs/state-machines.md', () => expect(fs.readFileSync('docs/state-machines.md', 'utf8')).toBe(machinesMarkdown()));
});

describe('every machine is well formed', () => {
  for (const m of MACHINES as unknown as typeof ORDER[]) {
    it(m.name, () => {
      for (const s of m.states) { expect(m.labels[s]).toBeTruthy(); expect(m.tones[s]).toBeTruthy(); }
      for (const mv of m.moves) {
        expect(m.states).toContain(mv.to);
        if (mv.from !== '*') for (const f of mv.from) expect(m.states).toContain(f);
      }
    });
  }
});

describe('Order', () => {
  const open = { invoiced: false }, inv = { invoiced: true };
  it('keeps every move the shop made by hand on an order without its invoice', () => {
    for (const [a, b] of [['Pending', 'In Progress'], ['In Progress', 'Completed'], ['Completed', 'In Progress'], ['Pending', 'Cancelled'], ['Cancelled', 'Pending'], ['Cancelled', 'Completed']] as const) {
      expect(check(ORDER, a, b, 'set', open).ok).toBe(true);
    }
  });
  it('never sets Refunded as a label: only Refund does', () => {
    const v = check(ORDER, 'Completed', 'Refunded', 'set', open);
    expect(v.ok).toBe(false);
    expect(check(ORDER, 'Completed', 'Refunded', 'refund', inv).ok).toBe(true);
  });
  it('never leaves Refunded', () => {
    const v = check(ORDER, 'Refunded', 'Pending', 'set', open);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/final/);
  });
  it('an invoiced order keeps its status until the invoice is undone, and says so', () => {
    const v = check(ORDER, 'Completed', 'Pending', 'set', inv);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/undo the invoice/);
    expect(check(ORDER, 'Completed', 'Pending', 'undoInvoice', inv).ok).toBe(true);
    expect(check(ORDER, 'Completed', 'Completed', 'set', inv)).toEqual({ ok: true, noop: true });
  });
  it('a delivered parcel does not reopen a cancelled or refunded order', () => {
    expect(check(ORDER, 'Cancelled', 'Completed', 'delivered', open).ok).toBe(false);
    expect(check(ORDER, 'Refunded', 'Completed', 'delivered', open).ok).toBe(false);
    expect(check(ORDER, 'In Progress', 'Completed', 'delivered', open).ok).toBe(true);
  });
  it('a refusal lists what can happen instead', () => {
    const v = check(ORDER, 'Cancelled', 'Refunded', 'set', open);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.allowed.map(a => a.to)).toEqual(expect.arrayContaining(['Pending', 'In Progress', 'Completed']));
    expect(movesFrom(ORDER, 'Refunded', open)).toEqual([]);
  });
  it('assertMove throws a 409 the routes can answer', () => {
    try { assertMove(ORDER, 'Refunded', 'Pending', 'set', open); throw new Error('no'); } catch (e) {
      expect(e).toBeInstanceOf(MoveRefused);
      expect((e as MoveRefused).status).toBe(409);
    }
  });
  it('an old, unknown stored status is not stuck (guards still apply)', () => {
    expect(check(ORDER, 'Weird', 'Pending', 'set', open).ok).toBe(true);
    expect(check(ORDER, 'Weird', 'Pending', 'set', inv).ok).toBe(false);
    expect(check(ORDER, 'Weird', 'Refunded', 'set', open).ok).toBe(false);
  });
});

describe('Repair', () => {
  it('is collected only when nothing is owed (under a rupee is settled)', () => {
    expect(check(REPAIR, 'ready', 'collected', 'set', { balance: 500 }).ok).toBe(false);
    expect(check(REPAIR, 'ready', 'collected', 'set', { balance: 0.4 }).ok).toBe(true);
  });
  it('can be undone back to the shop', () => {
    expect(check(REPAIR, 'collected', 'received', 'set', { balance: 0 }).ok).toBe(true);
    expect(check(REPAIR, 'cancelled', 'received', 'set', { balance: 0 }).ok).toBe(true);
  });
});

describe('Payment link, website order, TCS booking', () => {
  it('a late payment on an expired link still counts; paid is final', () => {
    expect(check(LINK, 'expired', 'paid', 'paid', {}).ok).toBe(true);
    expect(check(LINK, 'paid', 'open', 'paid', {}).ok).toBe(false);
  });
  it('a website order is confirmed once', () => {
    expect(check(ONLINE, 'confirmed', 'confirming', 'claim', {}).ok).toBe(false);
    expect(check(ONLINE, 'pending', 'declined', 'decline', {}).ok).toBe(true);
  });
  it('no parcel is booked on a closed order, and a moving one is not cancelled', () => {
    expect(check(BOOKING, 'none', 'pending', 'book', { orderOpen: false, parcelMoving: false }).ok).toBe(false);
    expect(check(BOOKING, 'booked', 'cancelled', 'cancel', { orderOpen: true, parcelMoving: true }).ok).toBe(false);
    expect(check(BOOKING, 'cancelled', 'pending', 'book', { orderOpen: true, parcelMoving: false }).ok).toBe(true);
  });
});
