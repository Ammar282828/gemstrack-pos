/**
 * Every place in the ERP, in one list: the sidebar, the top bar's tabs, the Ctrl+K palette and
 * the page headings all read it (the audit of 2026-10-01).
 *
 * The sidebar (app-layout.tsx) and the palette (command-palette.tsx) were two hand-kept lists
 * that had drifted — different names for the same page, pages missing from one, and a palette
 * that ignored roles. A page is added here or it is nowhere; nav.test.ts fails when a page under
 * src/app is in no entry, when an entry points at no page, or when two rows of a group share a name.
 *
 *   entry   a sidebar row. `tabs` are its sibling pages, shown in the top bar; the row opens the
 *           first tab the person may see.
 *   tab     a sibling page. `match` names other paths that light it (a detail page, an import);
 *           otherwise the longest tab `href` a path starts with is the lit one.
 *   pages   pages reached from an entry but not tabs of it: found by the palette, titled by the
 *           registry, lighting the tab whose prefix they sit under.
 *   action  something to make (New order, New repair…) — the palette's Create group.
 *
 * `staff` marks what shop-floor accounts may open (absent: owners only). `when` reads the house's
 * flags (store-config.ts); a house that has switched a page off doesn't show it anywhere.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Home, PlusCircle, ClipboardList, Receipt, Wrench, Users, FileClock, Hammer, Boxes, Send, Globe, Megaphone,
  Wallet, TrendingUp, Settings as SettingsIcon, Calendar, Briefcase, Package, Gem, Layers, ImagePlus, Scale,
  PenLine, Coins, Target, BookUser, PieChart, Landmark, Tag, ArchiveRestore, RotateCcw, Mic, History, Palette,
  Rocket, BarChart3, UsersRound, ListChecks, SlidersHorizontal, Contact, Import, Database, ScanLine, Camera,
  LayoutGrid, Bell, Plug, Banknote,
} from 'lucide-react';
import {
  STORE_LINKS, STORE_PARTNERSHIP, STORE_WEBSITE_WEIGHTS, STORE_SITE_EDIT, STORE_INVESTMENTS, STORE_POST_PIECE,
  STORE_SITE_POSTS, STORE_META_ADS, STORE_AD_STUDIO, STORE_BRAND,
} from '@/lib/store-config';

export type NavGroup = 'home' | 'sales' | 'workshop' | 'marketing' | 'money' | 'footer';

/** The sidebar headings, in order. Home needs none; the footer is Settings alone. */
export const GROUPS: { key: NavGroup; label: string }[] = [
  { key: 'home', label: '' },
  { key: 'sales', label: 'Sales' },
  { key: 'workshop', label: 'Workshop & stock' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'money', label: 'Money' },
];

interface Place {
  href: string;
  label: string;
  /** Reachable by shop-floor staff. Absent means owners only. */
  staff?: boolean;
  /** Whether this house has it at all (store-config flags). Absent: always. */
  when?: () => boolean;
  /** Other words people use for it, for the palette. */
  keywords?: string[];
  /** The page's own heading, when it says more than the label ("Post from taheri.shop"). */
  heading?: string;
  icon?: LucideIcon;
  /** Other paths that belong here (prefixes: '/settings/backups' covers what is beneath it). */
  match?: string[];
}

export type NavTab = Place;

export interface NavEntry extends Place {
  id: string;
  icon: LucideIcon;
  group: NavGroup;
  tabs?: NavTab[];
  /** Pages reached from this entry that are not tabs of it (see the file's head). */
  pages?: Place[];
  /** A live count beside the label: unfinished drafts, or online orders waiting to be confirmed. */
  count?: 'drafts' | 'online';
  /** The palette names this entry's tabs `Entry › Tab` ("Ads › Studio"): their words alone are
   *  someone else's (Analytics' Customers is not the customer list). */
  qualify?: boolean;
  /** Its tabs carry the page's query along (Analytics' date range). */
  keepQuery?: boolean;
}

export interface NavAction extends Place {
  icon: LucideIcon;
}

const website = () => !!STORE_LINKS.website;

/** The primary action, drawn as a button under Search. */
export const NEW_SALE: NavEntry = {
  id: 'new-sale', group: 'sales', staff: true, href: '/new', label: 'New sale', icon: PlusCircle,
  keywords: ['sale', 'sell', 'bill', 'new sale'],
};

/**
 * The sidebar, by what the shop does (the owner, 2026-09-27: "reaudit the separation entirely"; before
 * that, 2026-09-25: "way too crowded"). Ordered within each group by how often it is reached for.
 */
export const NAV: NavEntry[] = [
  {
    id: 'home', group: 'home', staff: true, href: '/', label: 'Home', icon: Home, keywords: ['dashboard'],
    tabs: [
      { staff: true, href: '/', label: 'Dashboard', icon: Home },
      { staff: true, href: '/calendar', label: 'Calendar', icon: Calendar, keywords: ['due dates', 'activity'] },
      // Money in today by method, out, and the drawer (lib/analytics/todays-cash.ts). Owners: it is the till.
      { href: '/today', label: 'Today’s cash', icon: Banknote, keywords: ['cash', 'drawer', 'till', 'today', 'collected', 'daily cash'] },
    ],
  },
  { id: 'orders', group: 'sales', staff: true, href: '/orders', label: 'Orders', icon: ClipboardList, count: 'online', keywords: ['custom order', 'order', 'online order', 'website order', 'to confirm'] },
  // /invoices/new, /invoices/<id> and its /edit sit under it; /cart only redirects there (old links).
  { id: 'invoices', group: 'sales', staff: true, href: '/invoices', label: 'Invoices', icon: Receipt, keywords: ['bills', 'estimate', 'unpaid'], match: ['/cart'] },
  { id: 'repairs', group: 'sales', staff: true, href: '/repairs', label: 'Repairs', icon: Wrench, keywords: ['repair', 'fix'] },
  { id: 'customers', group: 'sales', staff: true, href: '/customers', label: 'Customers', icon: Users, keywords: ['clients', 'people'] },
  // Orders and sales started and not yet saved, on every device (owner, 2026-09-27).
  { id: 'drafts', group: 'sales', staff: true, href: '/drafts', label: 'Drafts', icon: FileClock, count: 'drafts', keywords: ['unfinished', 'saved'] },
  {
    id: 'workshop', group: 'workshop', staff: true, href: '/workshop', label: 'Workshop', icon: Hammer,
    tabs: [
      { staff: true, href: '/workshop', label: 'Jobs', heading: 'Workshop', icon: Hammer, keywords: ['bench', 'jobs', 'karigar work'] },
      { staff: true, href: '/karigars', label: 'Karigars', icon: Briefcase, keywords: ['craftsmen', 'kaarigar'] },
      { staff: true, href: '/given', label: 'Given items', icon: Package, keywords: ['given', 'gold given', 'issued'] },
    ],
  },
  {
    // Owners only by choice: staff read pieces to sell them (roles.ts STAFF_COLLECTIONS), but Stock is
    // where pieces are priced, edited and removed.
    id: 'stock', group: 'workshop', href: '/products', label: 'Stock', icon: Boxes, keywords: ['inventory', 'products', 'pieces'],
    tabs: [
      { href: '/products', label: 'Pieces', heading: 'Stock', icon: Gem, keywords: ['stock', 'inventory', 'products'] },
      { href: '/products/bulk-add', label: 'Add in bulk', icon: Layers, keywords: ['bulk', 'import pieces'] },
      // The tag designer and CSV export, moved from Settings (its address stays).
      { href: '/settings/printer', label: 'Labels', icon: Tag, keywords: ['label designer', 'tags', 'printer', 'zebra', 'weprint', 'csv'] },
      // Scan a tag into the sale; also offered on New sale.
      { href: '/scan', label: 'Scan', icon: ScanLine, keywords: ['scan', 'qr', 'barcode', 'tag'] },
    ],
  },
  {
    // Everything that goes out to WhatsApp and Instagram (owner, 2026-09-25: Investments belongs with Post a Piece).
    // The hub (2026-10-04) is what went out today, the queue, and the website's pieces — From the website was folded into it.
    id: 'posts', group: 'marketing', staff: true, href: '/posts', label: 'Posts', icon: Send,
    when: () => website() && (STORE_POST_PIECE || STORE_SITE_POSTS || STORE_INVESTMENTS),
    tabs: [
      { staff: true, href: '/posts', label: 'Hub', heading: 'Posts', icon: LayoutGrid, match: ['/website/from-site'], keywords: ['from the website', 'website post', 'share a piece', 'new arrivals', 'queue', 'posted today', 'posting hub'] },
      { staff: true, href: '/website/post', label: 'Post a piece', icon: Camera, when: () => STORE_POST_PIECE, keywords: ['post', 'story', 'instagram', 'whatsapp', 'community', 'channel', 'new photos'] },
      { staff: true, href: '/website/investments', label: 'Investments', icon: TrendingUp, when: () => STORE_INVESTMENTS, keywords: ['investment', 'gold post'] },
    ],
  },
  {
    id: 'website', group: 'marketing', staff: true, href: '/website/photos', label: 'Website', icon: Globe, when: website,
    tabs: [
      { staff: true, href: '/website/photos', label: 'Add photos', icon: ImagePlus, keywords: ['website', 'upload', 'photos'] },
      { staff: true, href: '/website/edit', label: 'Edit a piece', icon: PenLine, when: () => STORE_SITE_EDIT, keywords: ['website', 'edit', 'crop', 'photo', 'description', 'hide', 'overlay'] },
      { staff: true, href: '/website/weights', label: 'Photo weights', icon: Scale, when: () => STORE_WEBSITE_WEIGHTS, keywords: ['weights', 'website'] },
    ],
  },
  {
    // This house's Meta ad account (NEXT_PUBLIC_STORE_META_ADS). Owners: it is money.
    id: 'ads', group: 'marketing', href: '/ads', label: 'Ads', icon: Megaphone, when: () => STORE_META_ADS, qualify: true,
    keywords: ['meta', 'facebook', 'instagram ads', 'boost', 'ad spend'],
    // Five tabs (the audit of 2026-10-01; there were eight). Ad sets is reached from Campaigns and New ad
    // and lights Campaigns; Audiences and Rules are cards on Setup and light it. Their addresses stay.
    tabs: [
      { href: '/ads', label: 'Overview', heading: 'Ads', icon: BarChart3 },
      { href: '/ads/campaigns', label: 'Campaigns', icon: ListChecks, keywords: ['campaigns', 'ad sets running'], match: ['/ads/adset'] },
      // The creative is made before the ad, so the Studio comes first (NEXT_PUBLIC_STORE_AD_STUDIO).
      { href: '/ads/studio', label: 'Studio', icon: Palette, when: () => STORE_AD_STUDIO, keywords: ['creative', 'design', 'canva', 'competitors', 'ad photos', 'drive', 'guide', 'ad studio'] },
      { href: '/ads/new', label: 'New ad', icon: Rocket, keywords: ['boost', 'promote', 'advertise', 'meta ad'] },
      { href: '/ads/setup', label: 'Setup', icon: SlidersHorizontal, keywords: ['connect', 'pixel', 'permissions', 'ad account'], match: ['/ads/audiences', '/ads/rules'] },
    ],
    pages: [
      { href: '/ads/adset', label: 'Ad sets', icon: LayoutGrid, keywords: ['ad set', 'audience test'] },
      { href: '/ads/audiences', label: 'Audiences', icon: UsersRound, keywords: ['lookalike', 'custom audience'] },
      { href: '/ads/rules', label: 'Rules', icon: ListChecks, keywords: ['automated rules'] },
    ],
  },
  {
    id: 'money', group: 'money', href: '/expenses', label: 'Money', icon: Wallet,
    tabs: [
      { href: '/expenses', label: 'Expenses', icon: Wallet, keywords: ['money', 'spend', 'costs'] },
      { href: '/additional-revenue', label: 'Extra revenue', icon: Coins, keywords: ['income', 'revenue', 'money'] },
      { href: '/overheads', label: 'Overheads', icon: Target, keywords: ['overheads', 'rent', 'salaries', 'benchmark'] },
      { href: '/hisaab', label: 'Hisaab', icon: BookUser, keywords: ['khata', 'ledger', 'accounts', 'owed'] },
      // The partnership book, for the shop that has partners (NEXT_PUBLIC_STORE_PARTNERSHIP).
      { href: '/shareholders', label: 'Shareholders', icon: PieChart, when: () => STORE_PARTNERSHIP, keywords: ['shareholders', 'partners', 'drawings'] },
    ],
  },
  {
    id: 'analytics', group: 'money', href: '/analytics', label: 'Analytics', icon: TrendingUp, qualify: true, keepQuery: true,
    keywords: ['reports', 'sales report', 'monthly pdf'],
    tabs: [
      { href: '/analytics', label: 'Overview', heading: 'Analytics', icon: TrendingUp },
      { href: '/analytics/sales', label: 'Sales', icon: BarChart3, keywords: ['by day', 'months', 'years', 'payments'] },
      { href: '/analytics/products', label: 'Products', icon: Gem, keywords: ['best sellers', 'pieces sold'] },
      { href: '/analytics/customers', label: 'Customers', icon: Users, keywords: ['top customers'] },
      { href: '/analytics/categories', label: 'Categories', icon: LayoutGrid },
    ],
  },
];

/** Settings, pinned to the footer as a gear rather than a group of its own. */
export const SETTINGS: NavEntry = {
  id: 'settings', group: 'footer', href: '/settings', label: 'Settings', icon: SettingsIcon, keywords: ['preferences'],
  // One route per tab (the audit of 2026-10-01: Settings had seven top-bar tabs and six in-page ones).
  // The rates left for the top bar's chip; Labels went to Stock; Security's sign-in log and lock to Activity.
  tabs: [
    { href: '/settings', label: 'Shop', heading: 'Settings', icon: SettingsIcon, keywords: ['shop details', 'theme', 'appearance', 'numbering', 'liquid glass'] },
    { href: '/settings/alerts', label: 'Alerts', icon: Bell, keywords: ['notifications', 'whatsapp alerts', 'reports', 'monthly pdf'] },
    { href: '/settings/payment-methods', label: 'Bank accounts', icon: Landmark, keywords: ['bank', 'iban', 'accounts', 'payment methods'] },
    { href: '/settings/integrations', label: 'Integrations', icon: Plug, keywords: ['shopify', 'website selling', 'meta'] },
    { href: '/settings/data', label: 'Data', icon: Database, keywords: ['backups', 'import', 'restore defaults', 'drafts'],
      match: ['/settings/backups', '/settings/recently-removed', '/settings/contact-import', '/settings/hisaab-import', '/settings/import-taheri'] },
    { href: '/activity-log', label: 'Activity', heading: 'Activity', icon: History, keywords: ['activity log', 'history', 'who changed', 'sign-in', 'emergency lock', 'security'] },
    { href: '/settings/voice', label: 'Voice', icon: Mic, keywords: ['microphone'] },
  ],
  pages: [
    { href: '/settings/backups', label: 'Backups', icon: ArchiveRestore, keywords: ['backup', 'export', 'restore'] },
    { href: '/settings/recently-removed', label: 'Recently removed', icon: RotateCcw, keywords: ['deleted', 'trash', 'restore'] },
    { href: '/settings/contact-import', label: 'Import contacts', icon: Contact, keywords: ['phone book', 'vcf'] },
    { href: '/settings/hisaab-import', label: 'Import hisaab', icon: Import, keywords: ['ledger import'] },
    { href: '/settings/import-taheri', label: 'Import Taheri Software book', icon: Database, when: () => STORE_BRAND === 'taheri' },
    // Switched off: its endpoint never existed (audit, 2026-10-01). Kept so an old bookmark lands somewhere.
    { href: '/settings/weprint-api', label: 'WEPrint', icon: Tag, when: () => false },
  ],
};

/** Things to make, for the palette's Create group. */
export const ACTIONS: NavAction[] = [
  { staff: true, href: '/new', label: 'New sale', icon: PlusCircle, keywords: ['sell'] },
  { staff: true, href: '/invoices/new', label: 'New invoice', icon: Receipt, keywords: ['bill', 'estimate'] },
  { staff: true, href: '/orders/add', label: 'New order', icon: ClipboardList, keywords: ['custom order'] },
  { staff: true, href: '/repairs?new=1', label: 'New repair', icon: Wrench, keywords: ['repair ticket'] },
  { staff: true, href: '/customers/add', label: 'New customer', icon: Users },
  { href: '/karigars/add', label: 'New karigar', icon: Briefcase },
  { href: '/products/add', label: 'New piece', icon: Gem, keywords: ['new product', 'add stock'] },
  { staff: true, href: '/scan', label: 'Scan a tag', icon: ScanLine, keywords: ['scan', 'qr', 'barcode'] },
];

/** Every entry, the sidebar's and the footer's. */
export const ALL_ENTRIES: NavEntry[] = [NEW_SALE, ...NAV, SETTINGS];

const on = (p: Place) => !p.when || p.when();

/** Is this path `href`, or beneath it? ('/' only matches itself; a query is ignored.) */
export function within(pathname: string, href: string): boolean {
  const h = href.split('?')[0];
  return pathname === h || (h !== '/' && pathname.startsWith(h + '/'));
}

/**
 * A person's view of an entry: absent if the house doesn't have it or they may not open it; else
 * only the tabs and pages they can, and the entry opens the first tab.
 */
export function forRole(entry: NavEntry, staff: boolean): NavEntry | null {
  if (!on(entry) || (staff && !entry.staff)) return null;
  if (!entry.tabs) return entry;
  const tabs = entry.tabs.filter(t => on(t) && (!staff || t.staff));
  if (!tabs.length) return null;
  const pages = entry.pages?.filter(p => on(p) && (!staff || p.staff));
  return { ...entry, href: tabs[0].href, tabs, pages };
}

/** The sidebar for a person: groups in order, each with the rows they can see. Empty groups go. */
export function sidebarFor(staff: boolean): { key: NavGroup; label: string; entries: NavEntry[] }[] {
  return GROUPS
    .map(g => ({ ...g, entries: NAV.filter(e => e.group === g.key).map(e => forRole(e, staff)).filter((e): e is NavEntry => !!e) }))
    .filter(g => g.entries.length > 0);
}

/** How strongly a place claims a path: the length of its longest matching href or `match`, or -1. */
function claim(p: Place, pathname: string): number {
  return [p.href, ...(p.match ?? [])].reduce((best, h) => (within(pathname, h) ? Math.max(best, h.split('?')[0].length) : best), -1);
}

/**
 * The entry a path belongs to, and the tab it lights: whichever of the person's entries claims the
 * path longest, by its tabs, its pages (which light the tab they sit under) or its own href.
 */
export function locate(pathname: string, entries: NavEntry[]): { entry: NavEntry; tab: NavTab | null } | null {
  let best: { entry: NavEntry; tab: NavTab | null; score: number } | null = null;
  for (const entry of entries) {
    const tabScores = (entry.tabs ?? []).map(t => ({ t, s: claim(t, pathname) }));
    const topTab = tabScores.reduce<{ t: NavTab; s: number } | null>((a, b) => (b.s >= 0 && (!a || b.s > a.s) ? b : a), null);
    const pageScore = Math.max(-1, ...(entry.pages ?? []).map(p => claim(p, pathname)));
    const own = claim(entry, pathname);
    const score = Math.max(topTab?.s ?? -1, pageScore, own);
    if (score < 0) continue;
    // A page lights the tab whose prefix it sits under (the longest), when there is one.
    let tab = topTab?.t ?? null;
    if (pageScore > (topTab?.s ?? -1)) {
      tab = (entry.tabs ?? []).filter(t => t.href !== '/' && pathname.startsWith(t.href.split('?')[0] + '/'))
        .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
    }
    if (!best || score > best.score) best = { entry, tab, score };
  }
  return best && { entry: best.entry, tab: best.tab };
}

/** The heading a page gets: its tab's or page's own heading, else its label; an entry without tabs, its label. */
export function pageTitle(pathname: string, entries: NavEntry[] = ALL_ENTRIES): string | undefined {
  for (const e of entries) {
    const place = e.tabs?.find(t => t.href === pathname) ?? e.pages?.find(p => p.href === pathname)
      ?? (!e.tabs && e.href === pathname ? e : undefined);
    if (place) return place.heading ?? place.label;
  }
  return undefined;
}

/** A page's heading and icon from the registry (PageShell's defaults). */
export function pageHeading(pathname: string): { title: string; icon: LucideIcon } | undefined {
  for (const e of ALL_ENTRIES) {
    const place = e.tabs?.find(t => t.href === pathname) ?? e.pages?.find(p => p.href === pathname)
      ?? (!e.tabs && e.href === pathname ? e : undefined);
    if (place) return { title: place.heading ?? place.label, icon: place.icon ?? e.icon };
  }
  return undefined;
}

export interface Destination { key: string; label: string; href: string; icon: LucideIcon; keywords: string[]; group: 'Go to' | 'Create' }

/**
 * The palette's places for a person: every row, tab and page they can open, and every action. A
 * tab's label is `Entry › Tab` when the entry qualifies its tabs or when the label alone is another
 * place's too; a tab at its entry's own address is the entry (its label becomes a keyword).
 */
export function paletteFor(staff: boolean): Destination[] {
  const entries = ALL_ENTRIES.map(e => forRole(e, staff)).filter((e): e is NavEntry => !!e);
  const raw: (Destination & { entry?: NavEntry; tabLabel?: string })[] = [];
  for (const e of entries) {
    const own = e.tabs?.find(t => t.href === e.href);
    raw.push({ key: `e:${e.id}`, label: e.label, href: e.href, icon: e.icon, group: 'Go to', keywords: [...(e.keywords ?? []), ...(own ? [own.label, ...(own.keywords ?? [])] : [])] });
    for (const t of e.tabs ?? []) {
      if (t.href === e.href) continue;
      raw.push({ key: `t:${t.href}`, label: t.label, href: t.href, icon: t.icon ?? e.icon, group: 'Go to', keywords: [e.label, ...(t.keywords ?? [])], entry: e, tabLabel: t.label });
    }
    for (const p of e.pages ?? []) {
      raw.push({ key: `p:${p.href}`, label: p.label, href: p.href, icon: p.icon ?? e.icon, group: 'Go to', keywords: [e.label, ...(p.keywords ?? [])] });
    }
  }
  const count = new Map<string, number>();
  for (const d of raw) count.set(d.label.toLowerCase(), (count.get(d.label.toLowerCase()) ?? 0) + 1);
  const places: Destination[] = raw.map(({ entry, tabLabel, ...d }) =>
    entry && tabLabel && (entry.qualify || (count.get(tabLabel.toLowerCase()) ?? 0) > 1) ? { ...d, label: `${entry.label} › ${tabLabel}` } : d);
  const actions: Destination[] = ACTIONS.filter(a => on(a) && (!staff || a.staff))
    .map(a => ({ key: `a:${a.href}`, label: a.label, href: a.href, icon: a.icon, group: 'Create', keywords: a.keywords ?? [] }));
  return [...places.filter(p => p.key !== 'e:new-sale'), ...actions];
}

/** Every address the registry names, whatever the house's flags — for nav.test.ts. */
export function registryHrefs(): string[] {
  const out = new Set<string>();
  for (const e of ALL_ENTRIES) {
    out.add(e.href);
    for (const t of e.tabs ?? []) out.add(t.href);
    for (const p of e.pages ?? []) out.add(p.href);
    for (const m of [e, ...(e.tabs ?? []), ...(e.pages ?? [])].flatMap(x => x.match ?? [])) out.add(m);
  }
  for (const a of ACTIONS) out.add(a.href);
  return [...out].map(h => h.split('?')[0]);
}
