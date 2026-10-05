import { describe, expect, it } from 'vitest';
import { toWhatsAppNumber, whatsAppLink } from './whatsapp';

describe('a number as WhatsApp dials it', () => {
  it('gives a Pakistani number written any local way its 92', () => {
    expect(toWhatsAppNumber('0300 1234567')).toBe('923001234567');
    expect(toWhatsAppNumber('+92 300 1234567')).toBe('923001234567');
    expect(toWhatsAppNumber('923001234567')).toBe('923001234567');
    expect(toWhatsAppNumber('300 1234567')).toBe('923001234567');
  });

  it('keeps a number from abroad as it is — no 92 in front (2026-10-05)', () => {
    expect(toWhatsAppNumber('+1 (415) 555-1234')).toBe('14155551234');
    expect(toWhatsAppNumber('+14155551234')).toBe('14155551234');
    expect(toWhatsAppNumber('+44 20 7946 0958')).toBe('442079460958');
    expect(toWhatsAppNumber('+971 50 123 4567')).toBe('971501234567');
    expect(toWhatsAppNumber('001 415 555 1234')).toBe('14155551234');
    expect(toWhatsAppNumber('14155551234')).toBe('14155551234');
    expect(whatsAppLink('+1 415 555 1234', 'hi')).toBe('https://wa.me/14155551234?text=hi');
  });

  it('has nothing to dial for nothing', () => {
    expect(toWhatsAppNumber('')).toBe('');
    expect(toWhatsAppNumber(undefined)).toBe('');
  });
});
