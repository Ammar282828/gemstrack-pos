import { describe, expect, it } from 'vitest';
import { settlementOf, SETTLEMENT_STATES, SETTLEMENT_LABELS, SETTLEMENT_TONES } from './settlement';
import { balanceLine, balanceLineOf } from '@/lib/invoice-credit';
import { machinesJson } from './export';

describe('settlementOf: one derivation of due / partly / paid / credit / refunded', () => {
  it('owing with nothing paid is due, with something paid is partly', () => {
    expect(settlementOf({ balanceDue: 5_000, amountPaid: 0 })).toMatchObject({ state: 'due', label: 'Balance due', amountDue: 5_000, credit: 0 });
    expect(settlementOf({ balanceDue: 3_000, amountPaid: 2_000 })).toMatchObject({ state: 'partly', amountDue: 3_000 });
  });
  it('a balance of 0 is paid, and so is anything under a rupee either way', () => {
    for (const b of [0, 0.4, -0.4, undefined, null]) expect(settlementOf({ balanceDue: b as number })).toMatchObject({ state: 'paid', label: 'Paid in full', amountDue: 0, credit: 0 });
    expect(settlementOf(undefined).state).toBe('paid');
  });
  it('a balance below zero is the customer\'s credit', () => {
    expect(settlementOf({ balanceDue: -5_000 })).toMatchObject({ state: 'credit', label: 'Credit to customer', amountDue: 0, credit: 5_000 });
    expect(settlementOf({ balanceDue: -1 }).state).toBe('credit');
  });
  it('status Refunded wins over whatever the balance says (a Shopify-voided invoice kept 11,850)', () => {
    expect(settlementOf({ status: 'Refunded', balanceDue: 11_850, amountPaid: 0 })).toMatchObject({ state: 'refunded', label: 'Refunded', amountDue: 0, credit: 0 });
    expect(settlementOf({ status: 'Refunded', balanceDue: -400 })).toMatchObject({ state: 'refunded', credit: 0 });
  });
  it('every state has a label and a tone', () => {
    for (const s of SETTLEMENT_STATES) { expect(SETTLEMENT_LABELS[s]).toBeTruthy(); expect(SETTLEMENT_TONES[s]).toBeTruthy(); }
  });
  it('balanceLine keeps its outputs, and a refunded invoice has no Balance due', () => {
    expect(balanceLine(5_000)).toEqual({ label: 'Balance due', amount: 5_000, state: 'due' });
    expect(balanceLine(-5_000)).toEqual({ label: 'Credit to customer', amount: 5_000, state: 'credit' });
    expect(balanceLine(0)).toEqual({ label: 'Paid in full', amount: 0, state: 'paid' });
    expect(balanceLine(11_850, 'Refunded')).toEqual({ label: 'Refunded', amount: 0, state: 'refunded' });
    expect(balanceLineOf({ balanceDue: 11_850, status: 'Refunded' }).label).not.toMatch(/due/i);
    expect(balanceLineOf({ balanceDue: 11_850, status: 'Unpaid' }).state).toBe('due');
  });
  it('is exported for the apps (machines.json derived)', () => {
    const d = machinesJson().derived.find(x => x.name === 'Invoice settlement')!;
    expect(d.states).toEqual([...SETTLEMENT_STATES]);
    expect(d.labels.refunded).toBe('Refunded');
    expect(d.tones.credit).toBe('credit');
  });
});
