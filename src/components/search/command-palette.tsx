"use client";

/**
 * Ctrl+K — find anyone, or jump anywhere.
 *
 * A customer is standing at the counter and the question is asked mid-sentence. Reaching
 * for the sidebar, finding Customers, waiting for the list and scrolling it is four
 * actions too many, so the whole book answers to one keystroke and a few letters.
 *
 * Names are matched by SOUND as well as by spelling. The book is full of Bohra names that
 * every person in the shop spells differently — Fatema/Fathima, Batul/Batool — and a
 * substring search finds neither from the other. The phonetic scorer that the voice
 * assistant uses to pin a spoken name to a row does the same work here for a typed one.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { nameScore } from '@/lib/voice/phonetics';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Search, Users, Briefcase, Gem, Home, PlusCircle, Receipt, Hammer, ClipboardList, BookUser, TrendingUp, Settings as SettingsIcon, CreditCard, Calendar, ArrowRight, RotateCcw, Mic, Wrench } from 'lucide-react';

interface Item {
  id: string;
  label: string;
  sub?: string;
  group: string;
  icon: React.ReactNode;
  href: string;
}

const DESTINATIONS: Array<Omit<Item, 'id'>> = [
  { label: 'Home', group: 'Go to', icon: <Home className="h-4 w-4" />, href: '/' },
  { label: 'New Sale', group: 'Go to', icon: <PlusCircle className="h-4 w-4" />, href: '/new' },
  { label: 'Orders', group: 'Go to', icon: <ClipboardList className="h-4 w-4" />, href: '/orders' },
  { label: 'Invoices', group: 'Go to', icon: <Receipt className="h-4 w-4" />, href: '/invoices' },
  { label: 'Repairs', group: 'Go to', icon: <Wrench className="h-4 w-4" />, href: '/repairs' },
  { label: 'Workshop', group: 'Go to', icon: <Hammer className="h-4 w-4" />, href: '/workshop' },
  { label: 'Products', group: 'Go to', icon: <Gem className="h-4 w-4" />, href: '/products' },
  { label: 'Customers', group: 'Go to', icon: <Users className="h-4 w-4" />, href: '/customers' },
  { label: 'Karigars', group: 'Go to', icon: <Briefcase className="h-4 w-4" />, href: '/karigars' },
  { label: 'Hisaab / Ledger', group: 'Go to', icon: <BookUser className="h-4 w-4" />, href: '/hisaab' },
  { label: 'Expenses', group: 'Go to', icon: <CreditCard className="h-4 w-4" />, href: '/expenses' },
  { label: 'Calendar', group: 'Go to', icon: <Calendar className="h-4 w-4" />, href: '/calendar' },
  { label: 'Analytics', group: 'Go to', icon: <TrendingUp className="h-4 w-4" />, href: '/analytics' },
  { label: 'Settings', group: 'Go to', icon: <SettingsIcon className="h-4 w-4" />, href: '/settings' },
  { label: 'Voice', group: 'Go to', icon: <Mic className="h-4 w-4" />, href: '/settings/voice' },
  { label: 'Recently removed', group: 'Go to', icon: <RotateCcw className="h-4 w-4" />, href: '/settings/recently-removed' },
];

const NEW: Array<Omit<Item, 'id'>> = [
  { label: 'New customer', group: 'Create', icon: <Users className="h-4 w-4" />, href: '/customers/add' },
  { label: 'New karigar', group: 'Create', icon: <Briefcase className="h-4 w-4" />, href: '/karigars/add' },
  { label: 'New order', group: 'Create', icon: <ClipboardList className="h-4 w-4" />, href: '/orders/add' },
  { label: 'New product', group: 'Create', icon: <Gem className="h-4 w-4" />, href: '/products/add' },
];

/**
 * A name is a good enough match to offer when it sounds close, even if not one letter of
 * the query appears in it. Below this the list fills with everybody in the book.
 */
const PHONETIC_FLOOR = 0.62;

/** Open the palette from anywhere — the sidebar's Search entry uses this. */
const OPEN_EVENT = 'command-palette:open';
export function openCommandPalette(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const customers = useAppStore((s) => s.customers);
  const karigars = useAppStore((s) => s.karigars);
  const products = useAppStore((s) => s.products);
  const loadCustomers = useAppStore((s) => s.loadCustomers);
  const loadKarigars = useAppStore((s) => s.loadKarigars);

  // Ctrl+K / Cmd+K anywhere, including from inside a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_EVENT, onOpen); };
  }, []);

  // The lists are only worth fetching once somebody actually searches.
  useEffect(() => {
    if (!open) return;
    loadCustomers();
    loadKarigars();
    setQ('');
    setCursor(0);
  }, [open, loadCustomers, loadKarigars]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();

    const destinations: Item[] = [...NEW, ...DESTINATIONS].map((d, i) => ({ ...d, id: `d${i}` }));

    if (!needle) return destinations.slice(0, 10);

    const people: Array<{ item: Item; score: number }> = [];

    const consider = (
      id: string,
      name: string,
      sub: string | undefined,
      group: string,
      icon: React.ReactNode,
      href: string,
      haystack: string,
    ) => {
      const hay = haystack.toLowerCase();
      const at = hay.indexOf(needle);
      // A literal match always beats a sound-alike, and a match at the start of the name
      // beats one buried in a phone number.
      let score = -1;
      if (at === 0) score = 3;
      else if (at > 0) score = 2;
      else {
        const phonetic = nameScore(needle, name);
        if (phonetic >= PHONETIC_FLOOR) score = 1 + phonetic;
      }
      if (score < 0) return;
      people.push({ item: { id, label: name, sub, group, icon, href }, score });
    };

    for (const c of customers) {
      consider(
        `c${c.id}`,
        c.name,
        [c.phone, c.city].filter(Boolean).join(' · ') || undefined,
        'Customers',
        <Users className="h-4 w-4" />,
        `/customers/${c.id}`,
        `${c.name} ${c.phone ?? ''} ${c.altPhone ?? ''} ${c.city ?? ''}`,
      );
    }
    for (const k of karigars) {
      consider(
        `k${k.id}`,
        k.name,
        [k.specialty, k.contact].filter(Boolean).join(' · ') || undefined,
        'Karigars',
        <Briefcase className="h-4 w-4" />,
        `/karigars/${k.id}`,
        `${k.name} ${k.contact ?? ''} ${k.specialty ?? ''}`,
      );
    }
    for (const p of products.slice(0, 400)) {
      const hay = `${p.name} ${p.sku}`.toLowerCase();
      const at = hay.indexOf(needle);
      if (at === -1) continue;
      people.push({
        item: {
          id: `p${p.sku}`,
          label: p.name,
          sub: p.sku,
          group: 'Products',
          icon: <Gem className="h-4 w-4" />,
          href: `/products/${encodeURIComponent(p.sku)}`,
        },
        score: at === 0 ? 3 : 2,
      });
    }

    const matchedDestinations = destinations
      .filter((d) => d.label.toLowerCase().includes(needle))
      .map((item) => ({ item, score: 3 }));

    return [...matchedDestinations, ...people]
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.item);
  }, [q, customers, karigars, products]);

  useEffect(() => setCursor(0), [q]);

  const run = useCallback((item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }, [router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[cursor]);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor, items]);

  let lastGroup = '';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0" onKeyDown={onKeyDown}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-3 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a name, or jump to a screen…"
            aria-label="Search"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {!items.length && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nothing matches “{q}”
            </div>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? ((lastGroup = it.group), it.group) : null;
            return (
              <div key={it.id}>
                {header && (
                  <div className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  data-on={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => run(it)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                    i === cursor ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <span className="shrink-0 text-muted-foreground">{it.icon}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.sub && <span className="shrink-0 truncate text-xs text-muted-foreground">{it.sub}</span>}
                  <ArrowRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
          <span>↑↓ move</span><span>↵ open</span><span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
