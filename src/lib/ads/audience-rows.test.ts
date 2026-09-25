import { describe, expect, it } from 'vitest';
import { countryOfPhone, customerRows, metaEmail, metaName, metaPhone, splitName } from './audience-rows';

describe('metaPhone — digits, country code, no leading zeros', () => {
  it.each([
    ['0300 1234567', '923001234567'],
    ['+92 300 1234567', '923001234567'],
    ['0092-300-1234567', '923001234567'],
    ['923001234567', '923001234567'],
    ['3001234567', '923001234567'],
    ['+971 50 123 4567', '971501234567'],
    ['(021) 3521-1234', '922135211234'],
    ['12', ''],
    ['', ''],
    ['n/a', ''],
  ])('%s → %s', (raw, want) => expect(metaPhone(raw)).toBe(want));
});

describe('emails and names', () => {
  it('lowercases emails and drops ones that aren’t', () => {
    expect(metaEmail('  Fatema@Gmail.COM ')).toBe('fatema@gmail.com');
    expect(metaEmail('not an email')).toBe('');
  });
  it('keeps letters only, lowercase, without accents', () => {
    expect(metaName("D'Souza-Khan")).toBe('dsouzakhan');
    expect(metaName('José')).toBe('jose');
  });
  it('first and last word, without titles', () => {
    expect(splitName('Mrs. Fatema Ali Hussain')).toEqual({ fn: 'fatema', ln: 'hussain' });
    expect(splitName('Murtaza')).toEqual({ fn: 'murtaza', ln: '' });
    expect(splitName('  ')).toEqual({ fn: '', ln: '' });
  });
  it('reads the country from the number', () => {
    expect(countryOfPhone('923001234567')).toBe('pk');
    expect(countryOfPhone('971501234567')).toBe('ae');
    expect(countryOfPhone('15551234567')).toBe('us');
    expect(countryOfPhone('8612345678')).toBe('');
  });
});

describe('customerRows', () => {
  const NOW = Date.parse('2026-09-25T00:00:00Z');
  const customers = [
    { id: 'c1', name: 'Fatema Ali', phone: '0300 1111111', email: 'F@x.com' },
    { id: 'c2', name: 'Zainab', phone: '0300 2222222', altPhone: '+971 50 000 0000' },
    { id: 'c3', name: 'Old Buyer', phone: '0300 3333333' },
    { id: 'c4', name: 'Email Only', email: 'e@x.com' },
    { id: 'c5', name: 'Nothing' },
    { id: 'c6', name: 'Same Number', phone: '+92 300 1111111' },
  ];
  const invoices = [
    { customerId: 'c1', createdAt: '2026-08-01T00:00:00Z' },
    { customerContact: '03002222222', createdAt: '2026-01-01T00:00:00Z' },
    { customerId: 'c3', createdAt: '2024-05-01T00:00:00Z' },
  ];
  it('every customer with a phone or email; a second number is a second row; repeats and the unreachable left out', () => {
    expect(customerRows(customers, invoices, 'all', NOW)).toEqual([
      ['923001111111', 'f@x.com', 'fatema', 'ali', 'pk'],
      ['923002222222', '', 'zainab', '', 'pk'],
      ['971500000000', '', 'zainab', '', 'ae'],
      ['923003333333', '', 'old', 'buyer', 'pk'],
      ['', 'e@x.com', 'email', 'only', ''],
    ]);
  });
  it('buyers are matched by customer id or by the invoice’s phone', () => {
    expect(customerRows(customers, invoices, 'buyers', NOW).map(r => r[0])).toEqual(['923001111111', '923002222222', '971500000000', '923003333333']);
  });
  it('recent = invoiced in the last year; lapsed = only before that', () => {
    expect(customerRows(customers, invoices, 'recent', NOW).map(r => r[2])).toEqual(['fatema', 'zainab', 'zainab']);
    expect(customerRows(customers, invoices, 'lapsed', NOW).map(r => r[2])).toEqual(['old']);
  });
});
