import { describe, expect, it } from 'vitest';
import { pieceCounts, stageOf, statusAfterUntick, statusFromPieces } from './order-stage';

const k = (karigarId?: string, isCompleted = false) => ({ karigarId, isCompleted });

describe('statusFromPieces', () => {
  it('every piece with a karigar takes a new order to In Progress', () => {
    expect(statusFromPieces('Pending', [k('a'), k('b')])).toBe('In Progress');
    expect(statusFromPieces('Pending', [k('a'), k()])).toBeNull();
    expect(statusFromPieces('Pending', [k('a'), k('none')])).toBeNull();
  });
  it('every piece finished takes it to Completed, from Pending or In Progress', () => {
    expect(statusFromPieces('In Progress', [k('a', true), k('b', true)])).toBe('Completed');
    expect(statusFromPieces('Pending', [k(undefined, true)])).toBe('Completed');
    expect(statusFromPieces('In Progress', [k('a', true), k('b')])).toBeNull();
  });
  it('never moves a finished, cancelled, refunded or invoiced order, nor one with no pieces', () => {
    for (const s of ['Completed', 'Cancelled', 'Refunded']) expect(statusFromPieces(s, [k('a', true)])).toBeNull();
    expect(statusFromPieces('In Progress', [k('a', true)], true)).toBeNull();
    expect(statusFromPieces('Pending', [])).toBeNull();
    expect(statusFromPieces('Pending', undefined)).toBeNull();
  });
});

describe('statusAfterUntick', () => {
  it('a finished order goes back to In Progress, unless it is invoiced', () => {
    expect(statusAfterUntick('Completed')).toBe('In Progress');
    expect(statusAfterUntick('Completed', true)).toBeNull();
    expect(statusAfterUntick('In Progress')).toBeNull();
  });
});

describe('stageOf', () => {
  it('sorts orders the way they are worked', () => {
    expect(stageOf({ status: 'Completed' })).toBe('ready');
    expect(stageOf({ status: 'In Progress' })).toBe('karigar');
    expect(stageOf({ status: 'Pending' })).toBe('new');
    expect(stageOf({ status: 'Completed', invoiceId: 'INV-1' }, 5000)).toBe('payment');
    expect(stageOf({ status: 'Completed', invoiceId: 'INV-1' }, 0)).toBe('done');
    expect(stageOf({ status: 'Refunded', invoiceId: 'INV-1' }, 5000)).toBe('closed');
    expect(stageOf({ status: 'Cancelled' })).toBe('closed');
  });
});

describe('pieceCounts', () => {
  it('counts pieces, those without a karigar and those finished', () => {
    expect(pieceCounts([k('a', true), k(), k('none')])).toEqual({ total: 3, unassigned: 2, done: 1 });
    expect(pieceCounts(null)).toEqual({ total: 0, unassigned: 0, done: 0 });
  });
});
