import { describe, expect, it } from 'vitest';
import { batchPayments, batchTotal, isOpenBatch, karigarPay, karigarSilver, silverProblem, silverSurcharge, type PayBatch, type PayExpense, type SilverRow } from './karigar-pay';

// Made-up karigars, batches and amounts. ERPCore's KarigarPayTests runs these same cases.
const pay = (id: string, date: string, amount: number, more: Partial<PayExpense> = {}): PayExpense => ({ id, date, amount, karigarId: 'k1', ...more });
const batch = (id: string, startDate: string, more: Partial<PayBatch> = {}): PayBatch => ({ id, karigarId: 'k1', label: id.toUpperCase(), startDate, ...more });

describe('karigarPay', () => {
  const batches = [
    batch('b-aug', '2026-08-01T09:00:00.000Z', { closedDate: '2026-08-31T18:00:00.000Z' }),
    batch('b-sep', '2026-09-01T09:00:00.000Z', { closedDate: '2026-09-30T18:00:00.000Z' }),
    batch('b-oct', '2026-10-01T09:00:00.000Z'),
    batch('b-other', '2026-10-02T09:00:00.000Z', { karigarId: 'k2' }),
  ];
  const expenses = [
    pay('e1', '2026-08-10T10:00:00.000Z', 5_000, { batchId: 'b-aug' }),
    pay('e2', '2026-09-12T10:00:00.000Z', 7_000, { batchId: 'b-sep' }),
    pay('e3', '2026-09-20T10:00:00.000Z', 3_000, { batchId: 'b-sep' }),
    pay('e4', '2026-10-03T10:00:00.000Z', 4_000, { batchId: 'b-oct' }),
    pay('e5', '2026-10-05T10:00:00.000Z', 6_000, { batchId: 'b-oct' }),
    pay('e6', '2026-07-01T10:00:00.000Z', 1_500),
    pay('e7', '2026-10-04T10:00:00.000Z', 900, { karigarId: 'k2', batchId: 'b-other' }),
    pay('e8', '2026-10-06T10:00:00.000Z', 250, { karigarId: undefined }),
  ];

  it('adds every payment to him, in the batches and outside them, and nobody else\'s', () => {
    expect(karigarPay({ karigarId: 'k1', expenses, batches }).totalPaid).toBe(26_500);
  });

  it('files his payments under the open batch, newest first', () => {
    const p = karigarPay({ karigarId: 'k1', expenses, batches });
    expect(p.open?.batch.id).toBe('b-oct');
    expect(p.open?.payments.map(e => e.id)).toEqual(['e5', 'e4']);
    expect(p.open?.total).toBe(10_000);
  });

  it('lists the settled batches newest first, each totalled from its payments as they are now', () => {
    const p = karigarPay({ karigarId: 'k1', expenses, batches: [...batches, batch('b-jul', '2026-07-01T09:00:00.000Z', { closedDate: '2026-07-31T18:00:00.000Z' })] });
    expect(p.settled.map(s => [s.batch.id, s.total, s.payments.map(e => e.id)])).toEqual([
      ['b-sep', 10_000, ['e3', 'e2']],
      ['b-aug', 5_000, ['e1']],
      ['b-jul', 0, []],
    ]);
  });

  it('keeps payments outside any batch apart, a blank batch id counting as none', () => {
    const p = karigarPay({ karigarId: 'k1', expenses: [...expenses, pay('e9', '2026-10-07T10:00:00.000Z', 100, { batchId: '' }), pay('e10', '2026-06-01T10:00:00.000Z', 50, { batchId: null })], batches });
    expect(p.direct.payments.map(e => e.id)).toEqual(['e9', 'e6', 'e10']);
    expect(p.direct.total).toBe(1_650);
  });

  it('lists a payment whose batch was deleted with the direct ones, and counts it in what he has been paid', () => {
    const p = karigarPay({ karigarId: 'k1', expenses: [pay('e1', '2026-10-01T10:00:00.000Z', 2_000, { batchId: 'gone' }), pay('e2', '2026-10-02T10:00:00.000Z', 500)], batches: [] });
    expect(p.totalPaid).toBe(2_500);
    expect(p.open).toBeNull();
    expect(p.settled).toEqual([]);
    expect(p.direct.payments.map(e => e.id)).toEqual(['e2', 'e1']);
    expect(p.direct.total).toBe(2_500);
  });

  it('takes the newest open batch when two are open, and a blank closing date as open', () => {
    const two = [batch('old', '2026-09-01T09:00:00.000Z'), batch('new', '2026-10-01T09:00:00.000Z', { closedDate: '' })];
    expect(karigarPay({ karigarId: 'k1', expenses: [], batches: two }).open?.batch.id).toBe('new');
    expect(isOpenBatch({ closedDate: '' })).toBe(true);
    expect(isOpenBatch({ closedDate: null })).toBe(true);
    expect(isOpenBatch({})).toBe(true);
    expect(isOpenBatch({ closedDate: '2026-10-01T00:00:00.000Z' })).toBe(false);
  });

  it('sorts a date it cannot read as the oldest, and keeps equal dates in the order they came', () => {
    const p = karigarPay({
      karigarId: 'k1',
      expenses: [pay('odd', 'someday', 10), pay('a', '2026-10-01T10:00:00.000Z', 20), pay('b', '2026-10-01T10:00:00.000Z', 30)],
      batches: [batch('x', 'soon', { closedDate: '2026-10-01T00:00:00.000Z' }), batch('y', '2026-09-01T09:00:00.000Z', { closedDate: '2026-09-30T00:00:00.000Z' })],
    });
    expect(p.direct.payments.map(e => e.id)).toEqual(['a', 'b', 'odd']);
    expect(p.settled.map(s => s.batch.id)).toEqual(['y', 'x']);
  });

  it('reads an amount kept as text, and one that is not a number as nothing', () => {
    const odd = [pay('t', '2026-10-01T10:00:00.000Z', '1500' as unknown as number), pay('n', '2026-10-02T10:00:00.000Z', 'lots' as unknown as number)];
    expect(karigarPay({ karigarId: 'k1', expenses: odd, batches: [] }).totalPaid).toBe(1_500);
  });
});

describe('batchTotal', () => {
  it('is what settling writes: his payments filed under the batch', () => {
    const b = batch('b-oct', '2026-10-01T09:00:00.000Z');
    const filed = [
      pay('e1', '2026-10-02T10:00:00.000Z', 4_000, { batchId: 'b-oct' }),
      pay('e2', '2026-10-03T10:00:00.000Z', 2_500, { batchId: 'b-oct' }),
      // Someone else's expense with the same batch id is not his.
      pay('e3', '2026-10-03T10:00:00.000Z', 9_999, { batchId: 'b-oct', karigarId: 'k2' }),
      pay('e4', '2026-10-04T10:00:00.000Z', 1_000),
    ];
    expect(batchTotal(b, filed)).toBe(6_500);
    expect(batchPayments(b, filed).map(e => e.id)).toEqual(['e2', 'e1']);
    expect(batchTotal(b, [])).toBe(0);
  });
});

describe('silver', () => {
  it('charges the grams at the rate per gram', () => {
    expect(silverSurcharge(12.5, 35)).toBe(437.5);
    expect(silverSurcharge(50, 0)).toBe(0);
  });

  it('says what the form says when the figures cannot be saved', () => {
    expect(silverProblem(0, 10)).toBe('Silver grams must be greater than 0');
    expect(silverProblem(-1, 10)).toBe('Silver grams must be greater than 0');
    expect(silverProblem(Number.NaN, 10)).toBe('Silver grams must be greater than 0');
    expect(silverProblem(5, -1)).toBe('Surcharge must be non-negative');
    expect(silverProblem(5, Number.POSITIVE_INFINITY)).toBe('Surcharge must be non-negative');
    expect(silverProblem(5, 0)).toBeNull();
    expect(silverProblem(0.001, 35)).toBeNull();
  });

  it('adds his entries, newest first, and nobody else\'s', () => {
    const rows: SilverRow[] = [
      { id: 's1', karigarId: 'k1', date: '2026-09-01T10:00:00.000Z', silverGrams: 50.5, surchargePerGram: 30, totalSurcharge: 1_515 },
      { id: 's2', karigarId: 'k1', date: '2026-10-01T10:00:00.000Z', silverGrams: 20, surchargePerGram: 35, totalSurcharge: 700 },
      { id: 's3', karigarId: 'k2', date: '2026-10-02T10:00:00.000Z', silverGrams: 99, surchargePerGram: 1, totalSurcharge: 99 },
    ];
    const s = karigarSilver('k1', rows);
    expect(s.rows.map(r => r.id)).toEqual(['s2', 's1']);
    expect(s.grams).toBeCloseTo(70.5, 9);
    expect(s.surcharge).toBe(2_215);
    expect(karigarSilver('nobody', rows)).toEqual({ rows: [], grams: 0, surcharge: 0 });
  });
});
