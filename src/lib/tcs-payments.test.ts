import { describe, expect, it } from 'vitest';
import { chargeExpenses, checkTcsCredentials, codReady, normaliseTcsCredentials, ociReady, parcelOf, payoutSummary, tcsDay } from './tcs-payments';

// TCS's own sample (API User Guide v1.0, Payment – Detail).
const row = (cn: string, booked: string, status: string, paid: 'Y' | 'N', amount: number, charges: number, delivered: string | null, paidOn: string | null = null) => ({
  'booking date': booked, 'cn by courier': cn, 'cn status': status, 'order no': 'Internet 591128', 'payment status': paid,
  'amount paid': amount, 'parcel weight': 1, city: 'KHI', 'delivery charges': charges, 'delivery date': delivered, 'payment date': paidOn,
});

describe('TCS payments', () => {
  it('reads a parcel; TCS writes days as day/month/year', () => {
    expect(tcsDay('09/09/2024')).toBe('2024-09-09');
    expect(tcsDay(null)).toBeNull();
    expect(parcelOf(row('779412322995', '09/09/2024', 'OK', 'N', 0, 118, '10/09/2024'))).toMatchObject({ cn: '779412322995', bookedOn: '2024-09-09', paid: false, deliveryCharges: 118, deliveredOn: '2024-09-10' });
    expect(parcelOf({ 'cn by courier': '' })).toBeNull();
  });

  it('a booking month\'s charges as one expense; what TCS has paid out and still owes', () => {
    const parcels = [
      parcelOf(row('779412322995', '09/09/2024', 'OK', 'N', 0, 118, '10/09/2024'))!,
      parcelOf(row('779412323054', '09/09/2024', 'OK', 'Y', 6350, 174, '13/09/2024', '20/09/2024'))!,
      parcelOf(row('779412323079', '02/10/2024', 'RO', 'N', 0, 116, null))!,
    ];
    const e = chargeExpenses(parcels, new Date('2024-10-05T00:00:00Z'));
    expect(e).toEqual([
      expect.objectContaining({ id: 'tcs-charges-2024-09', amount: 292, category: 'Courier & Delivery', description: 'TCS, September 2024: 2 parcels — delivery 292', date: '2024-09-30T12:00:00.000Z' }),
      expect.objectContaining({ id: 'tcs-charges-2024-10', amount: 116, date: '2024-10-05T00:00:00.000Z' }),
    ]);
    expect(payoutSummary(parcels)).toEqual({ paidOut: 6350, lastPaidOn: '2024-09-20', unpaidDelivered: 1 });
  });

  it('asks for the Cash on Delivery set; the secret and the city are optional', () => {
    const base = { clientId: '1', username: 'u', password: 'p', costCenterCode: 'KHI01', accountNo: '123' };
    expect(checkTcsCredentials({ ...base, accountNo: '' })).toMatch(/account/);
    expect(checkTcsCredentials({ ...base, costCenterCode: ' ' })).toMatch(/cost centre/);
    expect(checkTcsCredentials(base)).toBeNull();
    expect(checkTcsCredentials({ ...base, clientSecret: 'x', originCity: 'Lahore' })).toBeNull();
    expect(checkTcsCredentials({ ...base, originCity: 'x'.repeat(501) })).toMatch(/too long/);
  });

  it('reads an older save (customerNo) and says which API can run', () => {
    const old = normaliseTcsCredentials({ clientId: '1', clientSecret: 's', username: 'u', password: 'p', customerNo: '99' });
    expect(old).toMatchObject({ accountNo: '99', originCity: 'Karachi', clientSecret: 's' });
    expect(codReady(old)).toBe(false); // no cost centre yet
    expect(ociReady(old)).toBe(true);
    const cod = normaliseTcsCredentials({ clientId: '1', username: 'u', password: 'p', costCenterCode: 'C', accountNo: '9' });
    expect(codReady(cod)).toBe(true);
    expect(ociReady(cod)).toBe(false);
    expect(normaliseTcsCredentials(null)).toBeNull();
  });
});
