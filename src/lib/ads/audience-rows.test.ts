import { describe, expect, it } from 'vitest';
import { countryOfPhone, customerRows, metaEmail, metaName, metaPhone, splitName, websiteRule } from './audience-rows';

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

describe('website audiences', () => {
  it('buyers in the last 180 days, from the pixel', () => {
    expect(websiteRule('123', 180, 'Purchase')).toEqual({
      inclusions: { operator: 'or', rules: [{ event_sources: [{ id: '123', type: 'pixel' }], retention_seconds: 180 * 86_400, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'Purchase' }] } }] },
    });
  });
  it('added to cart but did not buy leaves the buyers out', () => {
    const r = websiteRule('123', 30, 'cart_not_bought') as { inclusions: { rules: { filter: { filters: { value: string }[] } }[] }; exclusions: { rules: { filter: { filters: { value: string }[] } }[] } };
    expect(r.inclusions.rules[0].filter.filters[0].value).toBe('AddToCart');
    expect(r.exclusions.rules[0].filter.filters[0].value).toBe('Purchase');
  });
  it('every visitor matches any page; days are held to Meta’s 180; an unknown kind is refused', () => {
    const all = websiteRule('123', 400, 'all') as { inclusions: { rules: { retention_seconds: number; filter: { filters: { field: string }[] } }[] } };
    expect(all.inclusions.rules[0].retention_seconds).toBe(180 * 86_400);
    expect(all.inclusions.rules[0].filter.filters[0].field).toBe('url');
    expect(websiteRule('123', 30, 'Nope')).toBeNull();
  });
});
