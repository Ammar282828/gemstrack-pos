import { describe, expect, it } from 'vitest';
import { carriesText, removedHistory, removedTotals } from './recently-removed';

// Case for case with the iPhone app's port (apps/iphone/Packages/ERPCore, RecentlyRemovedTests). Ids made up.

describe('what a removed person still carries', () => {
  const history = removedHistory(
    [{ entityId: 'cust-1' }, { entityId: 'cust-1' }, { entityId: 'kar-1' }, { entityId: '' }, {}],
    [{ customerId: 'cust-1' }, { customerId: 'cust-2' }, { customerId: 'kar-1' }, {}],
  );

  it('counts ledger entries by person and orders by customer', () => {
    expect(history.get('cust-1')).toEqual({ entries: 2, orders: 1 });
    expect(history.get('cust-2')).toEqual({ entries: 0, orders: 1 });
    expect(history.get('kar-1')).toEqual({ entries: 1, orders: 1 });
    expect(history.get('')).toBeUndefined();
    expect(history.size).toBe(3);
  });

  it('says it as the row does', () => {
    expect(carriesText({ entries: 2, orders: 1 })).toBe('2 ledger entries · 1 order');
    expect(carriesText({ entries: 1, orders: 0 })).toBe('1 ledger entry');
    expect(carriesText({ entries: 0, orders: 3 })).toBe('3 orders');
    expect(carriesText({ entries: 0, orders: 0 })).toBe('');
    expect(carriesText(undefined)).toBe('');
  });

  it('adds up what emptying the list would orphan: a karigar\'s entries, never orders', () => {
    expect(removedTotals(['cust-1', 'cust-2'], ['kar-1'], history)).toEqual({ entries: 3, orders: 2 });
    expect(removedTotals([], [], history)).toEqual({ entries: 0, orders: 0 });
  });
});
