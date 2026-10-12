import { describe, expect, it } from 'vitest';
import { ALL_ENTRIES, NAV, forRole, sidebarFor } from './nav';
import { PRIMARY_TAB_IDS, hidesTabBar, isRootPage, litTab, showsCreateCluster, tabEntries } from './tab-bar';

describe('the phone tab bar', () => {
  it('owners and staff get Home, Orders, Invoices, Customers, in that order', () => {
    for (const role of ['owner', 'staff'] as const) {
      expect(tabEntries(role, sidebarFor(role)).map(e => e.id)).toEqual([...PRIMARY_TAB_IDS]);
    }
  });
  it('marketing gets only marketing entries, never Home', () => {
    const tabs = tabEntries('marketing', sidebarFor('marketing'));
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.length).toBeLessThanOrEqual(4);
    expect(tabs.map(e => e.id)).not.toContain('home');
    expect(tabs.every(e => e.group === 'marketing')).toBe(true);
  });
  it('steps aside for create, edit and designer pages only', () => {
    for (const p of ['/new', '/orders/add', '/invoices/new', '/customers/add', '/products/add', '/karigars/add', '/scan', '/ads/new', '/ads/studio', '/ads/studio/x', '/website/post', '/orders/abc/edit']) {
      expect(hidesTabBar(p), p).toBe(true);
    }
    expect(hidesTabBar('/repairs', '?new=1')).toBe(true);
    for (const p of ['/', '/orders', '/invoices', '/customers', '/invoices/INV-1', '/posts', '/settings', '/repairs']) {
      expect(hidesTabBar(p), p).toBe(false);
    }
  });
  it('the create cluster shows on tab roots, not for marketing', () => {
    expect(showsCreateCluster('/', 'owner')).toBe(true);
    expect(showsCreateCluster('/orders', 'staff')).toBe(true);
    expect(showsCreateCluster('/orders/abc', 'owner')).toBe(false);
    expect(showsCreateCluster('/orders', 'marketing')).toBe(false);
  });
  it('a page in another entry lights Search; a detail page lights its tab', () => {
    const entries = ALL_ENTRIES.map(e => forRole(e, 'owner')).filter((e): e is NonNullable<typeof e> => !!e);
    const tabs = tabEntries('owner', sidebarFor('owner'));
    expect(litTab('/invoices/INV-1', entries, tabs)).toBe('invoices');
    expect(litTab('/', entries, tabs)).toBe('home');
    expect(litTab('/workshop', entries, tabs)).toBe('search');
    expect(litTab('/settings', entries, tabs)).toBe('search');
  });
  it('root pages have no back chevron', () => {
    const orders = NAV.find(e => e.id === 'orders');
    expect(isRootPage('/orders', orders)).toBe(true);
    expect(isRootPage('/orders/abc', orders)).toBe(false);
  });
});
