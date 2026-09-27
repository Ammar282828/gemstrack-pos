import { describe, expect, it } from 'vitest';
import {
  ORDER_DEFAULT_FIELDS, SALE_DEFAULT_FIELDS, DRAFT_MAX_BYTES, deviceName, draftHref, isExpired, isWorthKeeping,
  legacyAlreadySaved, newDraftId, summarizeOrder, summarizeSale, toStorable,
} from './work-drafts';

/** A blank order as the form mounts it: today's rates, a promised date, one blank exchange row. */
const blankOrder = () => ({
  items: [], goldRate18k: 0, goldRate21k: 41250, goldRate22k: 45000, goldRate24k: 49000,
  palladiumRate18k: 0, palladiumRate12k: 0, discountAmount: 0, advancePayment: 0, advanceMethod: 'Cash',
  exchangeRows: [{ id: 'ab12cd3', description: '', karat: '', weightG: '', ratePerGram: '', value: '', valueTyped: false }],
  advanceInExchangeDescription: '', advanceInExchangeValue: 0, customerId: '__WALK_IN__', customerName: '', customerContact: '',
  promisedDate: '2026-10-11', delivery: { required: false, address: '' },
});
const blankItem = { itemCategory: '', description: '', karat: '21k', estimatedWeightG: 0, wastagePercentage: 10, makingCharges: 0, metalType: 'gold', isCompleted: false };

describe('what is worth keeping', () => {
  it('a blank order is not a draft — rates, the promised date, blank rows and their ids say nothing', () => {
    expect(isWorthKeeping(blankOrder(), ORDER_DEFAULT_FIELDS)).toBe(false);
    expect(isWorthKeeping({ ...blankOrder(), items: [blankItem] }, ORDER_DEFAULT_FIELDS)).toBe(false);
  });
  it('a customer, a piece or an advance is', () => {
    expect(isWorthKeeping({ ...blankOrder(), customerName: 'Sana' }, ORDER_DEFAULT_FIELDS)).toBe(true);
    expect(isWorthKeeping({ ...blankOrder(), items: [{ ...blankItem, description: 'Ruby ring' }] }, ORDER_DEFAULT_FIELDS)).toBe(true);
    expect(isWorthKeeping({ ...blankOrder(), advancePayment: 5000 }, ORDER_DEFAULT_FIELDS)).toBe(true);
  });
  it('a blank sale is not a draft; pieces in the cart or a name are', () => {
    const blank = { walkInCustomerName: '', walkInCustomerPhone: '', discountAmountInput: '0', exchangeRows: [{ id: 'x1', description: '', value: '' }],
      internalNote: '', salePayments: [{ id: 'p1', amount: '', method: 'Cash', reference: '' }], selectedCustomerId: '__WALK_IN__', hideRates: false, cart: [], subtotal: 0 };
    expect(isWorthKeeping(blank, SALE_DEFAULT_FIELDS)).toBe(false);
    expect(isWorthKeeping({ ...blank, cart: [{ sku: 'R-12', name: 'Ring' }], subtotal: 120000 }, SALE_DEFAULT_FIELDS)).toBe(true);
    expect(isWorthKeeping({ ...blank, walkInCustomerName: 'Ali' }, SALE_DEFAULT_FIELDS)).toBe(true);
  });
});

describe('cards', () => {
  it('an order reads by customer, pieces and advance', () => {
    const s = summarizeOrder({ customerName: 'Sana Ali', advancePayment: 25000, items: [
      { ...blankItem, description: 'Ruby ring' }, { ...blankItem, description: 'Bangles' }, { ...blankItem, itemCategory: 'Chain' }, blankItem,
    ] }, 380000);
    expect(s.title).toBe('Sana Ali');
    expect(s.items).toBe(3);
    expect(s.detail).toBe('Ruby ring, Bangles +1 · advance PKR 25,000');
    expect(s.total).toBe(380000);
  });
  it('a sale reads by customer, the pieces in the cart and its total', () => {
    const s = summarizeSale({ walkInCustomerName: 'Ali', cart: [{ name: 'Gents ring' }, { sku: 'B-3' }], subtotal: 150000 });
    expect(s).toEqual({ title: 'Ali', detail: 'Gents ring, B-3', items: 2, total: 150000 });
    expect(summarizeSale({ cart: [] }, 'Registered Customer').title).toBe('Registered Customer');
    expect(summarizeSale({}).title).toBe('No customer yet');
  });
});

describe('storing', () => {
  it('drops undefined and keeps the rest', () => {
    expect(toStorable({ a: 1, b: undefined, c: [{ d: undefined, e: 'x' }] }).data).toEqual({ a: 1, c: [{ e: 'x' }] });
  });
  it('leaves big sample photos out rather than losing the draft', () => {
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(DRAFT_MAX_BYTES);
    const { data, leftOut } = toStorable({ customerName: 'Sana', items: [{ description: 'Ring', sampleImageDataUri: big }] });
    expect(leftOut).toEqual(['photos']);
    expect(data).toEqual({ customerName: 'Sana', items: [{ description: 'Ring', sampleImageDataUri: '' }] });
  });
});

describe('the rest', () => {
  it('ids, links and age', () => {
    expect(newDraftId('order', 0)).toMatch(/^order-0-[a-z0-9]+$/);
    expect(draftHref({ kind: 'order', id: 'order-1' })).toBe('/orders/add?draft=order-1');
    expect(draftHref({ kind: 'sale', id: 'sale-1' })).toBe('/cart?draft=sale-1');
    const now = Date.parse('2026-09-27T12:00:00Z');
    expect(isExpired({ updatedAt: '2026-09-20T12:00:00Z' }, now)).toBe(false);
    expect(isExpired({ updatedAt: '2026-08-20T12:00:00Z' }, now)).toBe(true);
    expect(isExpired({}, now)).toBe(true);
  });
  it('devices by name', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)')).toBe('Mac');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile')).toBe('Android phone');
  });
  it('an old on-device draft that was in fact saved is not carried over', () => {
    const draft = { kind: 'order' as const, savedAt: '2026-09-26T10:00:00Z', data: { customerName: 'Sana Ali' } };
    expect(legacyAlreadySaved(draft, [{ customerName: 'sana ali ', createdAt: '2026-09-26T10:02:00Z' }])).toBe(true);
    expect(legacyAlreadySaved(draft, [{ customerName: 'Sana Ali', createdAt: '2026-09-20T10:00:00Z' }])).toBe(false);
    expect(legacyAlreadySaved({ ...draft, data: {} }, [{ customerName: '', createdAt: '2026-09-27T00:00:00Z' }])).toBe(false);
  });
});
