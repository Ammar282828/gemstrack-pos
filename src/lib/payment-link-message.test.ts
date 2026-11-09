import { describe, it, expect } from 'vitest';
import { isSafepayKey, linkAmount, paymentLinkMessage } from './payment-link-message';

describe('payment link helpers', () => {
  it('accepts a public key and refuses anything else', () => {
    expect(isSafepayKey('sec_a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    expect(isSafepayKey('  sec_a1b2c3d4-e5f6-7890-abcd-ef1234567890 ')).toBe(true);
    expect(isSafepayKey('a1b2c3d4e5f67890abcdef1234567890aa')).toBe(false);
    expect(isSafepayKey('sec_short')).toBe(false);
    expect(isSafepayKey('')).toBe(false);
  });
  it('rounds to whole rupees, never negative', () => {
    expect(linkAmount('1234.6')).toBe(1235);
    expect(linkAmount(-5)).toBe(0);
    expect(linkAmount(undefined)).toBe(0);
  });
  it('words the message', () => {
    expect(paymentLinkMessage({ name: 'Sara', amount: 12500, id: 'INV-7', url: 'https://x/y', store: 'House of Mina' }))
      .toBe('Assalam o Alaikum Sara, please pay PKR 12,500 for INV-7 here: https://x/y — House of Mina');
    expect(paymentLinkMessage({ amount: 100, id: 'ORD-1', url: 'u', store: 'S' })).toBe('Assalam o Alaikum, please pay PKR 100 for ORD-1 here: u — S');
  });
});
