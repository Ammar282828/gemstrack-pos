/**
 * The phone's bottom tab bar (docs/features/web-matches-app.md, c.2): which entries it holds, which
 * pages it steps aside for, and where the create cluster shows. Everything is derived from lib/nav.ts
 * (sidebarFor / forRole / locate), so houses, flags and roles come through unchanged; nothing here is a
 * second list of pages.
 */

import { locate, within, type NavEntry, type NavRole } from '@/lib/nav';

/** The app's RootView.primary, by nav.ts entry id. Search (the map) is the fifth tab, drawn by the bar itself. */
export const PRIMARY_TAB_IDS = ['home', 'orders', 'invoices', 'customers'] as const;

/** Marketing has no Home or Orders: the first entries of its own group. */
const MARKETING_TABS = 4;

/**
 * The entries the bar shows for a person, in order. Owner and staff: the four primary ids that their
 * view of the menu has (staff have all four). Marketing: the first four entries of the Marketing group.
 */
export function tabEntries(navRole: NavRole, groups: { key: string; entries: NavEntry[] }[]): NavEntry[] {
  const all = groups.flatMap(g => g.entries);
  if (navRole === 'marketing') {
    return (groups.find(g => g.key === 'marketing')?.entries ?? all).slice(0, MARKETING_TABS);
  }
  return PRIMARY_TAB_IDS
    .map(id => all.find(e => e.id === id))
    .filter((e): e is NavEntry => !!e);
}

/**
 * The create and edit pages the app shows as modal sheets, and the designers: they carry their own
 * bottom bars (glass-bar totals), so the tab bar steps aside rather than stack a second one.
 */
const HIDING_EXACT = ['/new', '/orders/add', '/invoices/new', '/customers/add', '/products/add', '/karigars/add', '/scan', '/ads/new'];
const HIDING_PREFIX = ['/website/post', '/ads/studio', '/design/classic'];

export function hidesTabBar(pathname: string, search = ''): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (HIDING_EXACT.includes(p)) return true;
  if (p.endsWith('/edit')) return true;
  if (HIDING_PREFIX.some(h => within(p, h))) return true;
  if (p === '/repairs' && new URLSearchParams(search).get('new') === '1') return true;
  return false;
}

/** The pages whose floating create cluster shows (the app's tab roots). */
export const CREATE_ROOTS = ['/', '/orders', '/invoices', '/customers'] as const;

export function showsCreateCluster(pathname: string, navRole: NavRole): boolean {
  if (navRole === 'marketing') return false;
  return (CREATE_ROOTS as readonly string[]).includes(pathname) && !hidesTabBar(pathname);
}

/**
 * Which tab is lit: the tab whose entry `locate()` returns for the path; a page in any other entry
 * (Workshop, Money, Settings...) lights Search, because in the app those open from the Search tab.
 */
export function litTab(pathname: string, entries: NavEntry[], tabs: NavEntry[]): 'search' | string {
  const here = locate(pathname, entries);
  const hit = here && tabs.find(t => t.id === here.entry.id);
  return hit ? hit.id : 'search';
}

/** Is this one of the entry's own top-level pages (so a back chevron has nothing to go back to)? */
export function isRootPage(pathname: string, entry: NavEntry | undefined): boolean {
  if (!entry) return true;
  return [entry.href, ...(entry.tabs ?? []).map(t => t.href)].some(h => h.split('?')[0] === pathname);
}
