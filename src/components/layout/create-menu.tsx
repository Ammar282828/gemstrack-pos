"use client";

/**
 * The create cluster (docs/features/web-matches-app.md, c.5), replacing Home's New bubble: the "+" beside
 * the microphone, bottom-trailing above the tab bar, on the app's tab roots (/, /orders, /invoices,
 * /customers). It opens onto an invoice (selling a piece now), an order (making or ordering one) and
 * New sale... (/new: a repair, scan a tag, read a bill). Labels and addresses are nav.ts's ACTIONS.
 * Phone only: from md the sidebar's New sale and Ctrl+K cover it. The microphone is voice-bubble.tsx,
 * which sits at this cluster's right edge.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Receipt, ClipboardList, ScanLine } from 'lucide-react';
import { ACTIONS, type NavRole } from '@/lib/nav';
import { cn } from '@/lib/utils';

const CHOICES = [
  { href: '/invoices/new', hint: 'Selling a piece now', icon: Receipt },
  { href: '/orders/add', hint: 'Making or ordering a piece', icon: ClipboardList },
  { href: '/new', hint: 'A repair, scan a tag, read a bill', icon: ScanLine, more: true },
] as const;

export function CreateMenu({ navRole, show }: { navRole: NavRole; show: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // Navigating away (or the cluster hiding) closes the menu.
  useEffect(() => { if (!show) setOpen(false); }, [show]);

  if (!show) return null;
  const rows = CHOICES.map(c => {
    const a = ACTIONS.find(x => x.href === c.href);
    return a && (navRole === 'owner' || a.staff) ? { ...c, label: 'more' in c ? `${a.label}…` : a.label } : null;
  }).filter((r): r is NonNullable<typeof r> => !!r);
  if (!rows.length) return null;

  return (
    <div className="md:hidden">
      {open && (
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-background/50 backdrop-blur-[2px] animate-in fade-in-0 duration-200"
        />
      )}
      <div className="fixed bottom-[calc(49px+env(safe-area-inset-bottom)+16px)] right-20 z-50 flex flex-col items-end gap-2">
        {open && (
          <div
            role="menu"
            aria-label="Create"
            className="glass w-64 origin-bottom-right overflow-hidden rounded-2xl border bg-popover p-1.5 shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-200 ease-enter"
          >
            {rows.map(c => (
              <Link
                key={c.href}
                href={c.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <c.icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.hint}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Create"
          onClick={() => setOpen(o => !o)}
          className="glass-prominent flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-200 ease-enter active:scale-95"
        >
          <Plus className={cn('h-6 w-6 transition-transform duration-200 ease-enter', open && 'rotate-45')} />
        </button>
      </div>
    </div>
  );
}
