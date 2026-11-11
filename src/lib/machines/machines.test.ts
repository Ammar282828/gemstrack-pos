import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertMove, check, movesFrom, MoveRefused } from './machine';
import { BOOKING, LINK, MACHINES, ONLINE, ORDER, REPAIR, QUEUE, WHATSAPP_FLOW } from './index';
import { assertStillIn } from './expected';
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

describe('Post queue', () => {
  const ctx = { leaseLive: false, needsApproval: false, due: true, triesLeft: true };
  it('the tick claims what is due with tries left; a held piece only by Send now', () => {
    expect(check(QUEUE, 'scheduled', 'sending', 'claim', ctx).ok).toBe(true);
    expect(check(QUEUE, 'failed', 'sending', 'claim', ctx).ok).toBe(true);
    expect(check(QUEUE, 'held', 'sending', 'claim', ctx).ok).toBe(false);
    expect(check(QUEUE, 'held', 'sending', 'claimNow', ctx).ok).toBe(true);
    expect(check(QUEUE, 'scheduled', 'sending', 'claim', { ...ctx, due: false }).ok).toBe(false);
    expect(check(QUEUE, 'failed', 'sending', 'claim', { ...ctx, triesLeft: false }).ok).toBe(false);
    expect(check(QUEUE, 'failed', 'sending', 'claimNow', { ...ctx, triesLeft: false }).ok).toBe(true);
  });
  it('a piece an AI made is taken only once approved (approval is a guard, not a state)', () => {
    const ai = { ...ctx, needsApproval: true };
    expect(check(QUEUE, 'held', 'sending', 'claimNow', ai).ok).toBe(false);
    expect(check(QUEUE, 'held', 'scheduled', 'schedule', ai).ok).toBe(false);
    expect(check(QUEUE, 'held', 'scheduled', 'schedule', { ...ai, needsApproval: false }).ok).toBe(true);
  });
  it('a claim is taken over only after its lease lapses (sending → sending is a move, not a no-op)', () => {
    expect(check(QUEUE, 'sending', 'sending', 'claim', { ...ctx, leaseLive: true }).ok).toBe(false);
    expect(check(QUEUE, 'sending', 'sending', 'claim', ctx)).toMatchObject({ ok: true, noop: false });
    expect(check(QUEUE, 'sending', 'sending', 'claimNow', { ...ctx, leaseLive: true }).ok).toBe(false);
  });
  it('a live send cannot be held or rescheduled; a lapsed one can; sent is final', () => {
    expect(check(QUEUE, 'sending', 'failed', 'hold', { ...ctx, leaseLive: true }).ok).toBe(false);
    expect(check(QUEUE, 'sending', 'failed', 'hold', ctx).ok).toBe(true);
    expect(check(QUEUE, 'sending', 'scheduled', 'schedule', { ...ctx, leaseLive: true }).ok).toBe(false);
    expect(check(QUEUE, 'sent', 'held', 'hold', ctx).ok).toBe(false);
    expect(check(QUEUE, 'sent', 'sending', 'claimNow', ctx).ok).toBe(false);
  });
  it('only a sending piece ends sent or failed', () => {
    expect(check(QUEUE, 'sending', 'sent', 'sent', ctx).ok).toBe(true);
    expect(check(QUEUE, 'sending', 'failed', 'fail', ctx).ok).toBe(true);
    for (const from of ['held', 'scheduled', 'failed', 'draft']) { expect(check(QUEUE, from, 'sent', 'sent', ctx).ok).toBe(false); expect(check(QUEUE, from, 'failed', 'fail', ctx).ok).toBe(false); }
  });
});

describe('Order WhatsApp', () => {
  const cod = { kind: 'cod' as const }, bank = { kind: 'bank' as const };
  it('a failed flow takes the customer\'s reply, and only the reply-driven moves', () => {
    expect(check(WHATSAPP_FLOW, 'failed', 'confirmed', 'confirm', cod).ok).toBe(true);
    expect(check(WHATSAPP_FLOW, 'failed', 'declined', 'decline', cod).ok).toBe(true);
    expect(check(WHATSAPP_FLOW, 'failed', 'slip-received', 'slip', bank).ok).toBe(true);
    expect(check(WHATSAPP_FLOW, 'failed', 'paid', 'paid', bank).ok).toBe(false);
  });
  it('answers belong to their kind; answered is answered; no-whatsapp is final', () => {
    expect(check(WHATSAPP_FLOW, 'awaiting-confirmation', 'confirmed', 'confirm', bank).ok).toBe(false);
    expect(check(WHATSAPP_FLOW, 'awaiting-payment', 'slip-received', 'slip', cod).ok).toBe(false);
    expect(check(WHATSAPP_FLOW, 'confirmed', 'declined', 'decline', cod).ok).toBe(false);
    expect(check(WHATSAPP_FLOW, 'no-whatsapp', 'confirmed', 'confirm', cod).ok).toBe(false);
  });
  it('a failure is recorded only from where a send leaves a flow, never over an answer', () => {
    expect(check(WHATSAPP_FLOW, 'awaiting-confirmation', 'failed', 'fail', cod).ok).toBe(true);
    expect(check(WHATSAPP_FLOW, 'sent', 'failed', 'fail', { kind: 'paid' }).ok).toBe(true);
    expect(check(WHATSAPP_FLOW, 'confirmed', 'failed', 'fail', cod).ok).toBe(false);
    expect(check(WHATSAPP_FLOW, 'slip-received', 'failed', 'fail', bank).ok).toBe(false);
  });
});

describe('a move queued offline (`from`)', () => {
  it('is refused, in words, when the stored state is neither what the person saw nor already the target', () => {
    expect(() => assertStillIn(ORDER, 'order', 'Completed', 'Pending', 'Cancelled', { invoiced: false })).toThrow("This order is now Completed: your change to Cancelled from Pending wasn't applied.");
    try { assertStillIn(REPAIR, 'repair', 'collected', 'received', 'ready', { balance: 0 }); } catch (e) {
      expect(e).toBeInstanceOf(MoveRefused);
      expect(e).toMatchObject({ status: 409, machine: 'Repair', from: 'collected', to: 'ready' });
    }
  });
  it('passes when `from` matches, when it is absent, or when the record is already where it was going', () => {
    expect(() => assertStillIn(ORDER, 'order', 'Pending', 'Pending', 'Cancelled', { invoiced: false })).not.toThrow();
    expect(() => assertStillIn(ORDER, 'order', 'Completed', undefined, 'Cancelled', { invoiced: false })).not.toThrow();
    expect(() => assertStillIn(ORDER, 'order', 'Completed', '', 'Cancelled', { invoiced: false })).not.toThrow();
    expect(() => assertStillIn(ORDER, 'order', 'Cancelled', 'Pending', 'Cancelled', { invoiced: false })).not.toThrow();
  });
});
