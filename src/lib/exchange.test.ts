import { describe, it, expect } from 'vitest';
import {
  orderExchanges, invoiceExchanges, orderExchangeFields, invoiceExchangeFields, exchangeTotal, describeExchangeEntry,
  blankExchangeRow, rowsFromExchanges, exchangesFromRows, applyExchangeRowChange, exchangeRowsTotal,
} from './exchange';

describe('reading older documents', () => {
  it("an order's one exchange becomes one row", () => {
    expect(orderExchanges({ advanceInExchangeDescription: 'Old ring 21k 5.2g', advanceInExchangeValue: 95000 }))
      .toEqual([{ description: 'Old ring 21k 5.2g', value: 95000 }]);
  });
  it('an order with no exchange has no rows', () => {
    expect(orderExchanges({ advanceInExchangeValue: 0 })).toEqual([]);
  });
  it("an invoice's description and two amounts become two rows, described once", () => {
    expect(invoiceExchanges({ exchangeDescription: 'Old bangles', exchangeAmount1: 50000, exchangeAmount2: 20000 }))
      .toEqual([{ description: 'Old bangles', value: 50000 }, { description: '', value: 20000 }]);
  });
  it('the rows win over the old fields when both are there', () => {
    const rows = [{ description: 'Chain', karat: '22k', weightG: 10, ratePerGram: 20000, value: 200000 }];
    expect(invoiceExchanges({ exchanges: rows, exchangeDescription: 'x', exchangeAmount1: 1 })).toEqual(rows);
  });
});

describe('writing', () => {
  const rows = [
    { description: 'Old ring', karat: '22k', weightG: 5.2, ratePerGram: 21000, value: 109200 },
    { description: 'Broken chain', value: 40000 },
    { description: '', value: 0 },
  ];
  it('an order keeps the rows and their totals in the old fields', () => {
    const f = orderExchangeFields(rows);
    expect(f.exchanges).toHaveLength(2);
    expect(f.advanceInExchangeValue).toBe(149200);
    expect(f.advanceInExchangeDescription).toBe('Old ring · 22k · 5.2 g at 21,000/g; Broken chain');
  });
  it('an invoice keeps the rows and one total, so every old reader sums right', () => {
    const f = invoiceExchangeFields(rows);
    expect(f).toMatchObject({ exchangeAmount1: 149200 });
    expect('exchangeAmount2' in f).toBe(false);
  });
  it('nothing exchanged writes nothing', () => {
    expect(invoiceExchangeFields([])).toEqual({});
  });
  it('totals and descriptions', () => {
    expect(exchangeTotal(rows)).toBe(149200);
    expect(describeExchangeEntry({ description: '', weightG: 3, value: 1 })).toBe('Gold · 3 g');
    // Just an amount, the simple exchange: no metal is named for it.
    expect(describeExchangeEntry({ description: '', value: 5000 })).toBe('Exchange');
    expect(describeExchangeEntry({ description: 'Old watch', value: 5000 })).toBe('Old watch');
  });
});

describe('rows as typed', () => {
  it('grams × rate fills the value until a value is typed', () => {
    let r = blankExchangeRow();
    r = applyExchangeRowChange(r, { weightG: '5' });
    expect(r.value).toBe('');
    r = applyExchangeRowChange(r, { ratePerGram: '20000' });
    expect(r.value).toBe('100000');
    r = applyExchangeRowChange(r, { value: '95000' });
    r = applyExchangeRowChange(r, { weightG: '6' });
    expect(r.value).toBe('95000');
  });
  it('clearing a typed value lets grams × rate fill it again', () => {
    let r = applyExchangeRowChange(blankExchangeRow(), { value: '5000' });
    r = applyExchangeRowChange(r, { value: '' });
    r = applyExchangeRowChange(r, { weightG: '2', ratePerGram: '10000' });
    expect(r.value).toBe('20000');
  });
  it('round-trips through what is written, dropping blank rows', () => {
    const typed = [
      { ...blankExchangeRow(), description: 'Old ring', karat: '21k', weightG: '5.2', ratePerGram: '20000', value: '104000' },
      blankExchangeRow(),
    ];
    const written = exchangesFromRows(typed);
    expect(written).toEqual([{ description: 'Old ring', karat: '21k', weightG: 5.2, ratePerGram: 20000, value: 104000 }]);
    expect(exchangesFromRows(rowsFromExchanges(written))).toEqual(written);
    expect(exchangeRowsTotal(typed)).toBe(104000);
  });
  it('an invoice with no exchange opens with one empty row to type in', () => {
    expect(rowsFromExchanges([])).toHaveLength(1);
  });
});
