"use client";

/**
 * The phone's bottom tab bar (docs/features/web-matches-app.md, c.2): the app's RootView.primary
 * (Home, Orders, Invoices, Customers) and Search, which opens the whole map (map-sheet.tsx). Under
 * 768px only. Which entries it holds comes from lib/tab-bar.ts, i.e. from nav.ts for this person's role.
 *
 * It steps aside for the create/edit pages that carry their own bottom bars, and while the keyboard
 * is open (the visual viewport shrinks well below the window).
 */

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { forRole, ALL_ENTRIES, type NavEntry, type NavRole } from '@/lib/nav';
import { hidesTabBar, litTab } from '@/lib/tab-bar';
import { cn } from '@/lib/utils';

/** True while an on-screen keyboard covers the page (iOS shrinks the visual viewport, not the window). */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const read = () => setOpen(vv.height < window.innerHeight * 0.75);
    read();
    vv.addEventListener('resize', read);
    return () => vv.removeEventListener('resize', read);
  }, []);
  return open;
}

function Item({ label, icon: Icon, on, children, ...rest }: {
  label: string; icon: NavEntry['icon']; on: boolean; children?: React.ReactNode;
} & ({ href: string; onClick?: undefined } | { href?: undefined; onClick: () => void })) {
  const cls = cn(
    'relative flex min-h-[49px] flex-1 flex-col items-center justify-start gap-0.5 pt-1.5 text-2xs font-medium transition-colors',
    on ? 'text-primary [html.ui-glass_&]:rounded-full [html.ui-glass_&]:bg-foreground/[.09]' : 'text-muted-foreground',
  );
  const inner = (
    <>
      <span className="relative flex h-6 w-6 items-center justify-center">
        <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        {children}
      </span>
      <span className="max-w-full truncate px-0.5">{label}</span>
    </>
  );
  return rest.href !== undefined ? (
    <Link href={rest.href} aria-current={on ? 'page' : undefined} className={cls}>{inner}</Link>
  ) : (
    <button type="button" onClick={rest.onClick} aria-current={on ? 'page' : undefined} aria-haspopup="dialog" className={cls}>{inner}</button>
  );
}

function Bar({ navRole, tabs, onSearch, mapOpen, onlineWaiting }: {
  navRole: NavRole; tabs: NavEntry[]; onSearch: () => void; mapOpen: boolean; onlineWaiting: number;
}) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? '';
  const keyboard = useKeyboardOpen();
  if (hidesTabBar(pathname, search ? `?${search}` : '') || keyboard) return null;

  const entries = ALL_ENTRIES.map(e => forRole(e, navRole)).filter((e): e is NavEntry => !!e);
  const lit = mapOpen ? 'search' : litTab(pathname, entries, tabs);

  return (
    <nav
      aria-label="Main"
      // Standard: the iOS 18 bar, a hairline over a frosted card. Glass (html.ui-glass .glass-bar): inset capsule.
      className="glass-bar fixed inset-x-0 bottom-0 z-40 flex items-start border-t border-separator bg-card/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden [html.ui-glass_&]:rounded-full"
    >
      {tabs.map(t => (
        <Item key={t.id} href={t.href} label={t.label} icon={t.icon} on={lit === t.id}>
          {t.count === 'online' && onlineWaiting > 0 && (
            <span
              className="absolute -right-2.5 -top-1 min-w-[16px] rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-destructive-foreground"
              title={`${onlineWaiting} online order${onlineWaiting === 1 ? '' : 's'} to confirm`}
            >{onlineWaiting}</span>
          )}
        </Item>
      ))}
      <Item onClick={onSearch} label="Search" icon={Search} on={lit === 'search'} />
    </nav>
  );
}

export function TabBar(props: React.ComponentProps<typeof Bar>) {
  // useSearchParams needs a Suspense boundary above it in a layout.
  return <Suspense fallback={null}><Bar {...props} /></Suspense>;
}
