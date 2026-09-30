import { describe, expect, it } from 'vitest';
import { karigarPosition } from './karigar-position';
import type { WorkshopJob } from './workshop';

const job = (id: string, karigarId: string, status: string, weightG?: number, ageDays = 1) =>
  ({ id, karigarId, status, weightG, ageDays, metalType: 'gold', karat: '21k' }) as unknown as WorkshopJob;

describe('a karigar\'s position with the shop', () => {
  const p = karigarPosition({
    karigarId: 'k1', karigarName: 'Aslam Bhai',
    jobs: [job('a', 'k1', 'pending', 10, 3), job('b', 'k1', 'in-progress', 5.5, 9), job('c', 'k1', 'completed', 20), job('d', 'k2', 'pending', 7), job('e', 'k1', 'pending')],
    givenItems: [
      { id: 'g1', status: 'out', recipientType: 'karigar', recipientName: 'x', recipientId: 'k1', description: 'sample', date: '' },
      { id: 'g2', status: 'out', recipientType: 'karigar', recipientName: ' aslam  bhai', description: 'old record, no id', date: '' },
      { id: 'g3', status: 'returned', recipientType: 'karigar', recipientName: 'Aslam Bhai', recipientId: 'k1', description: 'back', date: '' },
      { id: 'g4', status: 'out', recipientType: 'karigar', recipientName: 'Aslam Bhai', recipientId: 'k9', description: 'another Aslam', date: '' },
    ],
    hisaab: [
      { entityType: 'karigar', entityId: 'k1', cashDebit: 30_000, cashCredit: 10_000, goldDebitGrams: 50, goldCreditGrams: 12 },
      { entityType: 'customer', entityId: 'k1', cashDebit: 99_999, cashCredit: 0 },
    ],
  });
  it('his bench: open jobs only, longest waiting first', () => {
    expect(p.bench.map(j => j.id)).toEqual(['b', 'a', 'e']);
  });
  it('metal out: the bench estimate and the gold khata, apart', () => {
    expect(p.metalOnBench).toEqual({ byMetal: { 'gold 21k': 15.5 }, unweighed: 1 });
    expect(p.goldKhata).toEqual({ given: 50, back: 12, net: 38 });
  });
  it('given items still out with him, by id, else by name for old records', () => {
    expect(p.given.map(g => g.id)).toEqual(['g1', 'g2']);
  });
  it('cash from his Hisaab only', () => {
    expect(p.cashBalance).toBe(20_000);
  });
});
