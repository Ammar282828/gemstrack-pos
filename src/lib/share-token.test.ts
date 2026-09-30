import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoiceShareUrl, isShareToken, newShareToken } from './share-token';

describe('the key in a customer\'s invoice link', () => {
  it('is long, random and safe in a URL', () => {
    const keys = new Set(Array.from({ length: 500 }, newShareToken));
    expect(keys.size).toBe(500);
    for (const k of keys) {
      expect(k).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(isShareToken(k)).toBe(true);
    }
  });
  it('turns away anything that is not one', () => {
    expect(isShareToken('')).toBe(false);
    expect(isShareToken('INV-000123')).toBe(false);
    expect(isShareToken(null)).toBe(false);
    expect(isShareToken('a'.repeat(19))).toBe(false);
    expect(isShareToken('abc def ghi jkl mno pqr')).toBe(false);
  });
  it('builds the link the counter sends', () => {
    expect(invoiceShareUrl('https://erp.taheri.shop/', 'INV-000123', 'k_ey-123'))
      .toBe('https://erp.taheri.shop/view-invoice/INV-000123?t=k_ey-123');
  });
});

describe('who may use the ERP', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  const owners = async () => (await import('./store-config')).STORE_CONFIG.allowedEmails;

  it('reads OWNER_EMAILS before ALLOWED_EMAILS, which a console override can pin', async () => {
    vi.stubEnv('NEXT_PUBLIC_STORE_ALLOWED_EMAILS', 'potatomasta501@gmail.com,minakhalid00@gmail.com');
    vi.stubEnv('NEXT_PUBLIC_STORE_OWNER_EMAILS', 'potatomasta501@gmail.com, mmurtaza1970@gmail.com,unknownuser80@gmail.com,hmurtaza55@gmail.com');
    expect(await owners()).toEqual(['potatomasta501@gmail.com', 'mmurtaza1970@gmail.com', 'unknownuser80@gmail.com', 'hmurtaza55@gmail.com']);
  });
  it('falls back to ALLOWED_EMAILS when OWNER_EMAILS is unset or blank (House of Mina)', async () => {
    vi.stubEnv('NEXT_PUBLIC_STORE_ALLOWED_EMAILS', 'potatomasta501@gmail.com,minakhalid00@gmail.com');
    vi.stubEnv('NEXT_PUBLIC_STORE_OWNER_EMAILS', '');
    expect(await owners()).toEqual(['potatomasta501@gmail.com', 'minakhalid00@gmail.com']);
  });
});
