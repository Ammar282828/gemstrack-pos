import { describe, expect, it } from 'vitest';
import {
  bucketOf, costBreakdown, costDescription, costOf, leafRows, moneyOf, orderIdCandidates, rowFor, sameShippingCost, shipmentCost, shippingCostOf,
} from './shipment-costs';
import { chargeExpenses, parcelOf } from './tcs-payments';

describe('bucketOf: plausible TCS spellings', () => {
  it.each([
    ['Delivery Charges', 'delivery'], ['deliveryCharges', 'delivery'], ['delivery_charges', 'delivery'], ['Charges', 'delivery'],
    ['GST', 'tax'], ['gstAmount', 'tax'], ['Sales Tax', 'tax'], ['SST', 'tax'], ['Service Tax', 'tax'],
    ['Fuel Surcharge', 'fuel'], ['fuel_surcharge', 'fuel'],
    ['COD Charges', 'codFee'], ['codCharges', 'codFee'], ['Handling Fee', 'codFee'],
    ['Insurance Charges', 'insurance'],
    ['W.H.T', 'withholding'], ['Withholding Tax', 'withholding'], ['wht', 'withholding'],
    ['Commission', 'other'], ['Service Charges', 'other'], ['Deduction', 'other'], ['Surcharge', 'other'],
  ])('%s → %s', (key, bucket) => expect(bucketOf(key)).toBe(bucket));

  it.each(['amount paid', 'COD Amount', 'Collected Amount', 'cn by courier', 'order no', 'parcel weight', 'payment status', 'GST Rate', 'delivery date', 'service type'])(
    '%s is not a cost', key => expect(bucketOf(key)).toBeNull());
});

describe('costOf', () => {
  it('TCS\'s own OCI row: the delivery charge only; amount paid is the payout, never a cost', () => {
    const c = costOf({ 'cn by courier': '779412323054', 'payment status': 'Y', 'amount paid': 6350, 'delivery charges': 174, city: 'KHI', 'parcel weight': 1 });
    expect(c).toMatchObject({ delivery: 174, tax: 0, total: 174, amountPaid: 6350 });
    expect(c.lines).toEqual({ 'delivery charges': 174 });
  });

  it('sorts every part and keeps the raw keys; withholding is listed but not in the total', () => {
    const c = costOf({
      'Delivery Charges': '118.00', GST: '19.5', 'Fuel Surcharge': 12, 'COD Charges': 30, Insurance: '5', 'W.H.T': 4, 'Other Charges': 1,
      'COD Amount': '6,350', 'Amount Paid': 0, 'GST Rate': 16, Weight: 1.5,
    });
    expect(c).toMatchObject({ delivery: 118, tax: 19.5, fuel: 12, codFee: 30, insurance: 5, withholding: 4, other: 1, total: 185.5, codCollected: 6350 });
    expect(c.lines).toEqual({ 'Delivery Charges': 118, GST: 19.5, 'Fuel Surcharge': 12, 'COD Charges': 30, Insurance: 5, 'W H T': 4, 'Other Charges': 1 });
  });

  it('camelCase and nested shapes', () => {
    expect(costOf({ deliveryCharges: 100, gstAmount: 16, fuelSurcharge: 8 })).toMatchObject({ delivery: 100, tax: 16, fuel: 8, total: 124 });
    expect(costOf({ charges: { delivery: 100, gst: 16 } })).toMatchObject({ delivery: 100, tax: 16, total: 116 });
    expect(costOf({ charges: [{ chargeName: 'GST', amount: 16 }, { chargeName: 'Delivery', amount: 100 }] })).toMatchObject({ delivery: 100, tax: 16, total: 116 });
  });

  it('a "total charges" figure only stands in when there are no parts (never doubled)', () => {
    expect(costOf({ 'Total Charges': 135, 'Delivery Charges': 118, GST: 17 })).toMatchObject({ delivery: 118, tax: 17, total: 135 });
    expect(costOf({ 'Total Charges': 135 })).toMatchObject({ delivery: 135, total: 135 });
  });

  it('nothing money-like: zero and no lines', () => {
    expect(costOf({ 'cn status': 'OK', 'amount paid': 0 })).toMatchObject({ total: 0, lines: {} });
    expect(moneyOf('Rs. 1,234.5')).toBe(1234.5);
    expect(moneyOf('09/09/2024')).toBeNull();
  });
});

describe('rows of a reply, and the stored record', () => {
  it('finds the parcel\'s row in a COD-style reply', () => {
    const reply = { returnStatus: { status: 'SUCCESS', code: '0200' }, paymentDetails: [{ consignmentNumber: '779412323054', deliveryCharges: 100, gst: 16, codAmount: 6350, paymentStatus: 'Y' }] };
    expect(leafRows(reply)).toHaveLength(1);
    const row = rowFor(reply, '779412323054')!;
    const c = costOf(row);
    expect(c).toMatchObject({ total: 116, codCollected: 6350 });
    const s = shipmentCost('779412323054', c, { source: 'tcs-cod', orderId: 'SHOPIFY-1', bookedOn: '2026-11-01', city: 'Lahore' }, new Date('2026-11-09T00:00:00Z'));
    expect(s).toMatchObject({ cn: '779412323054', orderId: 'SHOPIFY-1', total: 116, tax: 16, netReceived: 6234, source: 'tcs-cod' });
    expect(s.empty).toBeUndefined();
    expect(shippingCostOf(s)).toMatchObject({ cn: '779412323054', total: 116, tax: 16, netReceived: 6234 });
    expect(sameShippingCost({ ...shippingCostOf(s), updatedAt: 'x' }, shippingCostOf(s))).toBe(true);
  });

  it('net received takes off withholding; falls back to what TCS paid; an empty one is marked', () => {
    const w = shipmentCost('1', costOf({ 'COD Amount': 1000, 'Delivery Charges': 100, 'W.H.T': 10 }), { source: 'tcs-cod' }, new Date());
    expect(w.netReceived).toBe(890);
    const o = shipmentCost('2', costOf({ 'delivery charges': 100, 'amount paid': 900 }), { source: 'tcs-oci', paid: true }, new Date());
    expect(o.netReceived).toBe(900);
    expect(shipmentCost('3', costOf({}), { source: 'tcs-cod' }, new Date()).empty).toBe(true);
  });

  it('order references', () => {
    expect(orderIdCandidates('Internet 591128')).toEqual(['Internet 591128', 'SHOPIFY-591128']);
    expect(orderIdCandidates('SHOPIFY-1042')).toEqual(['SHOPIFY-1042']);
    expect(orderIdCandidates('')).toEqual([]);
  });
});

describe('the monthly expense', () => {
  const row = (cn: string, booked: string, extra: Record<string, unknown>) => ({ 'booking date': booked, 'cn by courier': cn, 'order no': 'x', 'delivery charges': 100, ...extra });
  it('sums the whole cost and says what it is made of; keeps the id', () => {
    const parcels = [
      parcelOf(row('779412322995', '09/11/2026', { GST: 16, 'Fuel Surcharge': 10, 'W.H.T': 3 }))!,
      parcelOf(row('779412322996', '10/11/2026', {}))!,
    ];
    const [e] = chargeExpenses(parcels, new Date('2026-11-20T00:00:00Z'));
    expect(e).toMatchObject({ id: 'tcs-charges-2026-11', amount: 226, description: 'TCS, November 2026: 2 parcels — delivery 200, tax 16, fuel 10' });
  });
  it('descriptions and the order-page breakdown', () => {
    expect(costDescription('2026-11', 42, { delivery: 8400, tax: 1344, fuel: 600, codFee: 0, insurance: 0, other: 0 })).toBe('TCS, November 2026: 42 parcels — delivery 8,400, tax 1,344, fuel 600');
    expect(costBreakdown({ delivery: 118, tax: 19, fuel: 3, codFee: 2, insurance: 0, other: 0 })).toBe('delivery 118 · tax 19 · other 5');
  });
});
