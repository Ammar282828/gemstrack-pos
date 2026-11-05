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

describe('staff who also run the marketing', () => {
  it('stay staff for the books, get marketing access, see no money and no ad spend', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_STORE_OWNER_EMAILS', 'owner@example.com');
    vi.stubEnv('NEXT_PUBLIC_STORE_STAFF_EMAILS', 'floor@example.com, both@example.com');
    vi.stubEnv('NEXT_PUBLIC_STORE_MARKETING_EMAILS', 'ads@example.com, both@example.com, owner@example.com');
    const r = await import('./roles');
    expect(r.roleForEmail('both@example.com')).toBe('staff');
    expect(r.alsoMarketing(' Both@example.com ')).toBe(true);
    expect(r.alsoMarketing('floor@example.com')).toBe(false);
    expect(r.alsoMarketing('owner@example.com')).toBe(false);
    expect(r.alsoMarketing('ads@example.com')).toBe(false);
    expect(r.marketingAccess('both@example.com')).toBe(true);
    expect(r.marketingAccess('ads@example.com')).toBe(true);
    expect(r.marketingAccess('owner@example.com')).toBe(true);
    expect(r.marketingAccess('floor@example.com')).toBe(false);
    expect(r.marketingAccess('nobody@example.com')).toBe(false);
    // Only owners see money; only the staff-and-marketing person has spend withheld (the marketing account keeps it).
    expect(r.seesMoney('owner@example.com')).toBe(true);
    for (const e of ['floor@example.com', 'both@example.com', 'ads@example.com', undefined, null, '']) expect(r.seesMoney(e)).toBe(false);
    expect(r.spendHidden('both@example.com')).toBe(true);
    expect(r.spendHidden('ads@example.com')).toBe(false);
    expect(r.spendHidden('owner@example.com')).toBe(false);
    vi.unstubAllEnvs();
  });

  it('customers have their aggregate money fields withheld from staff', async () => {
    vi.resetModules();
    const { staffView } = await import('./staff-view');
    const out = staffView('customers', { name: 'A', phone: '1', totalSpent: 5, balance: 9, creditBalance: 1 });
    expect(out).toEqual({ name: 'A', phone: '1' });
  });
});
