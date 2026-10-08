/**
 * The ERP's map (lib/nav.ts) as plain data, for the native iPhone app (apps/iphone): it draws its
 * menus from this, so every place the ERP has is in the app — natively once that screen is built,
 * as the ERP page inside the app until then — and a place added here reaches the app with the next
 * build. Evaluated per house (the `when` flags read store-config's environment).
 *
 * `npm run nav:export` writes apps/iphone/App/Resources/nav-<house>.json; nav-export.test.ts fails
 * when a committed file no longer matches the map.
 */

import type { NavEntry, NavTab, NavAction } from '@/lib/nav';

export interface ExportedPlace {
  href: string;
  label: string;
  heading?: string;
  /** lucide's name for the icon ("House"); the app maps it to an SF Symbol. */
  icon?: string;
  staff?: boolean;
  keywords?: string[];
  match?: string[];
}
export interface ExportedEntry extends ExportedPlace {
  id: string;
  group: string;
  tabs?: ExportedPlace[];
  pages?: ExportedPlace[];
  count?: string;
}
export interface ExportedNav {
  groups: { key: string; label: string }[];
  newSale: ExportedEntry;
  entries: ExportedEntry[];
  settings: ExportedEntry;
  actions: ExportedPlace[];
}

type Place = NavTab & { when?: () => boolean; icon?: { displayName?: string; name?: string } };

const iconName = (i: unknown) => {
  const c = i as { displayName?: string; name?: string } | undefined;
  return c?.displayName || c?.name || undefined;
};

function place(p: Place): ExportedPlace {
  return {
    href: p.href,
    label: p.label,
    ...(p.heading ? { heading: p.heading } : {}),
    ...(iconName(p.icon) ? { icon: iconName(p.icon) } : {}),
    ...(p.staff ? { staff: true } : {}),
    ...(p.keywords?.length ? { keywords: p.keywords } : {}),
    ...(p.match?.length ? { match: p.match } : {}),
  };
}

const on = (p: { when?: () => boolean }) => !p.when || p.when();

function entry(e: NavEntry): ExportedEntry {
  const tabs = e.tabs?.filter(on).map((t) => place(t as Place));
  const pages = e.pages?.filter(on).map((t) => place(t as Place));
  return {
    id: e.id,
    group: e.group,
    ...place(e as unknown as Place),
    ...(tabs?.length ? { tabs } : {}),
    ...(pages?.length ? { pages } : {}),
    ...(e.count ? { count: e.count } : {}),
  };
}

export function exportNav(nav: {
  GROUPS: { key: string; label: string }[];
  NEW_SALE: NavEntry;
  NAV: NavEntry[];
  SETTINGS: NavEntry;
  ACTIONS: NavAction[];
}): ExportedNav {
  return {
    groups: nav.GROUPS,
    newSale: entry(nav.NEW_SALE),
    entries: nav.NAV.filter(on).map(entry),
    settings: entry(nav.SETTINGS),
    actions: nav.ACTIONS.filter(on).map((a) => place(a as unknown as Place)),
  };
}
