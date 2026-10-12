"use client";

/**
 * The Search tab's sheet: the whole map of the ERP on a phone (docs/features/web-matches-app.md, c.3).
 * Idle, it lists the sidebar's groups for this person (nav.ts sidebarFor), then Settings and the account
 * block (light/dark, sign out). Typing filters every place the Ctrl+K palette knows (paletteFor), with the
 * palette's own matcher. It is a sheet, not a route, so nav.test.ts has nothing to register. Replaces the
 * hamburger sheet under md.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, LogOut, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { paletteFor, type NavEntry, type NavRole, type NavGroup } from '@/lib/nav';
import { scorePlace } from '@/lib/palette-match';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navRole: NavRole;
  groups: { key: NavGroup; label: string; entries: NavEntry[] }[];
  settings: NavEntry | null;
  pathname: string;
  draftCount: number;
  onlineWaiting: number;
  user: { displayName?: string | null; email?: string | null; photoURL?: string | null } | null;
  onSignOut: () => void;
  /** The light/dark switch, which lives in app-layout. */
  themeToggle: React.ReactNode;
}

function Row({ href, icon: Icon, label, sub, on, badge, onGo }: {
  href: string; icon: NavEntry['icon']; label: string; sub?: string; on?: boolean; badge?: React.ReactNode; onGo: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onGo}
      aria-current={on ? 'page' : undefined}
      className="flex min-h-[48px] items-center gap-3 px-4 py-2 active:bg-accent"
    >
      <Icon className={cn('h-5 w-5 flex-shrink-0', on ? 'text-primary' : 'text-muted-foreground')} strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-[17px]', on && 'font-semibold text-primary')}>{label}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {badge}
      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" aria-hidden />
    </Link>
  );
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="divide-y divide-border overflow-hidden rounded-[1.375rem] bg-card">{children}</div>
);

export function MapSheet({ open, onOpenChange, navRole, groups, settings, pathname, draftCount, onlineWaiting, user, onSignOut, themeToggle }: Props) {
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  const close = () => onOpenChange(false);

  const needle = q.trim().toLowerCase();
  const found = useMemo(() => {
    if (!needle) return [];
    return paletteFor(navRole)
      .map(d => ({ d, score: scorePlace(d.label, d.keywords, needle) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map(x => x.d);
  }, [needle, navRole]);

  const badgeFor = (e: NavEntry) =>
    e.count === 'drafts' && draftCount > 0 ? <span className="rounded-full bg-primary/15 px-2 text-xs font-semibold leading-5 text-primary">{draftCount}</span>
    : e.count === 'online' && onlineWaiting > 0 ? <span className="rounded-full bg-primary px-2 text-xs font-semibold leading-5 text-primary-foreground">{onlineWaiting}</span>
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          'flex max-w-none flex-col gap-0 max-sm:!w-screen max-sm:!max-w-none max-sm:!right-0 overflow-hidden bg-background p-0 '
          + 'max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 '
          + 'max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-bottom-4 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=open]:zoom-in-100 '
          + 'max-sm:[&>button:last-child]:hidden sm:max-w-md'
        }
      >
        <DialogTitle className="sr-only">Places in the ERP</DialogTitle>
        <div className="flex items-center gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted px-4 text-muted-foreground">
            <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Places in the ERP"
              aria-label="Search places"
              enterKeyHint="search"
              className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button type="button" aria-label="Clear" onClick={() => setQ('')} className="rounded-full p-0.5 hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
          <button type="button" onClick={close} className="h-11 px-1 text-[17px] font-medium text-primary">Close</button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
          {needle ? (
            found.length ? (
              <Card>
                {found.map(d => (
                  <Row key={d.key} href={d.href} icon={d.icon} label={d.label} sub={d.group === 'Create' ? 'Create' : undefined} onGo={close} />
                ))}
              </Card>
            ) : (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing matches “{q.trim()}”</p>
            )
          ) : (
            <div className="space-y-6">
              {groups.map(g => (
                <section key={g.key}>
                  {g.label && <h2 className="mb-2 px-1 font-serif text-xl font-semibold">{g.label}</h2>}
                  <Card>
                    {g.entries.map(e => (
                      <Row
                        key={e.id} href={e.href} icon={e.icon} label={e.label} badge={badgeFor(e)}
                        on={pathname === e.href || (e.href !== '/' && pathname.startsWith(e.href + '/'))}
                        onGo={close}
                      />
                    ))}
                  </Card>
                </section>
              ))}
              {settings && (
                <Card>
                  <Row href={settings.href} icon={settings.icon} label="Settings" on={pathname.startsWith('/settings')} onGo={close} />
                </Card>
              )}
              {user && (
                <section aria-label="Account">
                  <div className="flex items-center gap-3 rounded-[1.375rem] bg-card p-4">
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarImage src={user.photoURL ?? undefined} />
                      <AvatarFallback className="text-sm font-semibold">{user.displayName?.[0] ?? user.email?.[0] ?? '?'}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[17px] font-semibold leading-tight">{user.displayName || user.email}</p>
                      {user.displayName && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
                    </div>
                    {themeToggle}
                  </div>
                  <button
                    type="button"
                    onClick={() => { close(); onSignOut(); }}
                    className="mt-3 flex min-h-[48px] w-full items-center gap-3 rounded-[1.375rem] bg-card px-4 text-[17px] font-medium text-destructive"
                  >
                    <LogOut className="h-5 w-5" aria-hidden /> Sign out
                  </button>
                </section>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
