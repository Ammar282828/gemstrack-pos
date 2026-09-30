import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_ENTRIES, NAV, GROUPS, SETTINGS, forRole, locate, pageTitle, paletteFor, registryHrefs, sidebarFor } from './nav';

/** Pages that are no one's row on purpose: the customer's pages, the offline page, the karigar's own. */
const OUTSIDE = ['/links', '/view-invoice/[id]', '/~offline', '/my-work'];

const APP = join(__dirname, '..', 'app');
function pages(dir = APP): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (name === 'page.tsx') {
      const route = '/' + relative(APP, dir).split(sep).filter(s => !/^\(.*\)$/.test(s)).join('/');
      out.push(route === '/' ? '/' : route.replace(/\/$/, ''));
    }
  }
  return out.sort();
}

describe('the navigation registry has not drifted from the pages', () => {
  const routes = pages();
  const hrefs = registryHrefs();

  it('finds the pages', () => {
    expect(routes).toContain('/');
    expect(routes.length).toBeGreaterThan(40);
  });

  it('every page is a row, a tab, a page or an action — or a detail, add or edit page under one — or outside on purpose', () => {
    const lost = routes.filter(r => !OUTSIDE.includes(r) && !hrefs.some(h => r === h || (h !== '/' && r.startsWith(h + '/'))));
    expect(lost).toEqual([]);
  });

  it('every address in the registry has a page', () => {
    const missing = hrefs.filter(h => !routes.includes(h));
    expect(missing).toEqual([]);
  });

  it('no two rows of a group share a name, nor two tabs of a row', () => {
    for (const g of [...GROUPS.map(g => g.key), 'footer' as const]) {
      const labels = ALL_ENTRIES.filter(e => e.group === g && e.id !== 'new-sale').map(e => e.label.toLowerCase());
      expect(new Set(labels).size, `group ${g}`).toBe(labels.length);
    }
    for (const e of ALL_ENTRIES) {
      const tabs = (e.tabs ?? []).map(t => t.label.toLowerCase());
      expect(new Set(tabs).size, e.id).toBe(tabs.length);
    }
  });
});

describe('who sees what', () => {
  it('staff get only what they may open, and a row opens the first tab they can', () => {
    const staff = sidebarFor(true).flatMap(g => g.entries.map(e => e.id));
    expect(staff).toContain('orders');
    expect(staff).not.toContain('money');
    expect(staff).not.toContain('ads');
    expect(forRole(SETTINGS, true)).toBeNull();
  });
  it('the palette follows the same rule and flags', () => {
    const staff = paletteFor(true).map(d => d.href);
    expect(staff).toContain('/orders');
    expect(staff).not.toContain('/expenses');
    expect(staff).not.toContain('/settings/weprint-api');
    const owner = paletteFor(false);
    expect(owner.map(d => d.href)).toEqual(expect.arrayContaining(['/drafts', '/scan', '/settings/printer', '/repairs?new=1', '/cart', '/analytics/products']));
  });
  it('a tab whose words are another place\'s is named with its row', () => {
    const labels = paletteFor(false).map(d => d.label);
    expect(labels).toContain('Analytics › Customers');
    expect(labels).toContain('Customers');
    expect(labels).toContain('Ads › Studio');
    expect(labels).not.toContain('Overview');
  });
});

describe('where a page sits', () => {
  const entries = ALL_ENTRIES.map(e => forRole(e, false)).filter((e): e is NonNullable<typeof e> => !!e);
  it('a tab page lights its tab; a detail page lights the tab it sits under', () => {
    expect(locate('/karigars', entries)?.tab?.href).toBe('/karigars');
    expect(locate('/karigars/abc', entries)?.tab?.href).toBe('/karigars');
    expect(locate('/products/bulk-add', entries)?.tab?.href).toBe('/products/bulk-add');
    expect(locate('/products/RIN-000001', entries)?.tab?.href).toBe('/products');
    expect(locate('/hisaab/x1', entries)?.entry.id).toBe('money');
    expect(locate('/cart', entries)?.entry.id).toBe('invoices');
    expect(locate('/', entries)?.tab?.label).toBe('Dashboard');
    expect(locate('/settings/contact-import', entries)?.entry.id).toBe('settings');
  });
  it('headings come from the registry', () => {
    expect(pageTitle('/orders')).toBe('Orders');
    expect(pageTitle('/given')).toBe('Given items');
    expect(pageTitle('/workshop')).toBe('Workshop');
    expect(pageTitle('/additional-revenue')).toBe('Extra revenue');
    expect(pageTitle('/nowhere')).toBeUndefined();
  });
  it('every sidebar row has an icon and the groups keep their order', () => {
    for (const e of NAV) expect(e.icon, e.id).toBeTruthy();
    expect(sidebarFor(false).map(g => g.key)).toEqual(['home', 'sales', 'workshop', 'marketing', 'money']);
  });
});
