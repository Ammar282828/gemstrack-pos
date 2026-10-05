import { describe, expect, it, vi } from 'vitest';

describe('marketing accounts', () => {
  it('are their own role, and an owner or staff listing always wins', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_STORE_OWNER_EMAILS', 'owner@example.com');
    vi.stubEnv('NEXT_PUBLIC_STORE_STAFF_EMAILS', 'floor@example.com');
    vi.stubEnv('NEXT_PUBLIC_STORE_MARKETING_EMAILS', 'ads@example.com, Owner@example.com, floor@example.com');
    const { roleForEmail, isMarketing, MARKETING_COLLECTIONS } = await import('./roles');
    expect(roleForEmail('ads@example.com')).toBe('marketing');
    expect(roleForEmail(' ADS@example.com ')).toBe('marketing');
    expect(roleForEmail('owner@example.com')).toBe('owner');
    expect(roleForEmail('floor@example.com')).toBe('staff');
    expect(isMarketing('owner@example.com')).toBe(false);
    expect(roleForEmail('someone@example.com')).toBe('none');
    expect(MARKETING_COLLECTIONS).not.toContain('orders');
    expect(MARKETING_COLLECTIONS).not.toContain('customers');
    vi.unstubAllEnvs();
  });
});
