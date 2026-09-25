"use client";

/**
 * Ctrl+K (or Search at the top of the sidebar) — find an order or an invoice by the
 * customer's name, or jump anywhere.
 *
 * A customer is standing at the counter and the question is asked mid-sentence: where is
 * my order, what do I owe. So the search goes straight to their orders and invoices by
 * name — or by number or phone — rather than to the customer's record (the owner,
 * 2026-09-25: no customer search). Karigars and products are still found by name.
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
import { Search, Users, Briefcase, Gem, Home, PlusCircle, Receipt, Hammer, ClipboardList, BookUser, TrendingUp, Settings as SettingsIcon, CreditCard, Calendar, ArrowRight, RotateCcw, Mic, Wrench, Package, ImagePlus, Scale, Coins, Target, PieChart, Landmark, ArchiveRestore, History } from 'lucide-react';
import { STORE_LINKS, STORE_PARTNERSHIP, STORE_WEBSITE_WEIGHTS } from '@/lib/store-config';

interface Item {
  id: string;
  label: string;
  sub?: string;
  group: string;
  icon: React.ReactNode;
  href: string;
}

/** Search results grouped under these headings, in this order when they score alike. */
const GROUP_ORDER = ['Go to', 'Create', 'Orders', 'Invoices', 'Karigars', 'Products'];

const shortDate = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
};
/** A phone as it is saved (+92 335…) and as it is said at the counter (0335…), so either finds it. */
const phoneForms = (p?: string) => {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('92') ? `${d} 0${d.slice(2)}` : d;
};
const pkr = (n: number) => (n >= 100000 ? `PKR ${(n / 100000).toFixed(n >= 1000000 ? 1 : 2).replace(/\.?0+$/, '')} lac` : `PKR ${Math.round(n).toLocaleString('en-PK')}`);

/** Every page, including the ones that are now tabs of a sidebar entry (Given items,
 *  Overheads, Payment methods…), with the other words people use for them. Pages a
 *  house has switched off are left out, as in the sidebar. */
const DESTINATIONS: Array<Omit<Item, 'id'> & { keywords?: string[] }> = [
  { label: 'Home', group: 'Go to', icon: <Home className="h-4 w-4" />, href: '/', keywords: ['dashboard'] },
  { label: 'New Sale', group: 'Go to', icon: <PlusCircle className="h-4 w-4" />, href: '/new', keywords: ['sale', 'sell'] },
  { label: 'Orders', group: 'Go to', icon: <ClipboardList className="h-4 w-4" />, href: '/orders' },
  { label: 'Invoices', group: 'Go to', icon: <Receipt className="h-4 w-4" />, href: '/invoices', keywords: ['bills'] },
  { label: 'Repairs', group: 'Go to', icon: <Wrench className="h-4 w-4" />, href: '/repairs', keywords: ['repair', 'fix'] },
  { label: 'Customers', group: 'Go to', icon: <Users className="h-4 w-4" />, href: '/customers' },
  { label: 'Calendar', group: 'Go to', icon: <Calendar className="h-4 w-4" />, href: '/calendar', keywords: ['due dates'] },
  { label: 'Workshop', group: 'Go to', icon: <Hammer className="h-4 w-4" />, href: '/workshop', keywords: ['jobs', 'bench'] },
  { label: 'Karigars', group: 'Go to', icon: <Briefcase className="h-4 w-4" />, href: '/karigars', keywords: ['craftsmen', 'kaarigar'] },
  { label: 'Given Items', group: 'Go to', icon: <Package className="h-4 w-4" />, href: '/given', keywords: ['given', 'gold given', 'issued'] },
  { label: 'Products', group: 'Go to', icon: <Gem className="h-4 w-4" />, href: '/products', keywords: ['stock', 'inventory'] },
  ...(STORE_LINKS.website ? [
    { label: 'Add Photos', group: 'Go to', icon: <ImagePlus className="h-4 w-4" />, href: '/website/photos', keywords: ['website', 'upload', 'photos'] },
    ...(STORE_WEBSITE_WEIGHTS ? [{ label: 'Photo Weights', group: 'Go to', icon: <Scale className="h-4 w-4" />, href: '/website/weights', keywords: ['weights', 'website'] }] : []),
  ] : []),
  { label: 'Expenses', group: 'Go to', icon: <CreditCard className="h-4 w-4" />, href: '/expenses', keywords: ['money', 'spend'] },
  { label: 'Extra Revenue', group: 'Go to', icon: <Coins className="h-4 w-4" />, href: '/additional-revenue', keywords: ['income', 'revenue', 'money'] },
  { label: 'Monthly Overheads', group: 'Go to', icon: <Target className="h-4 w-4" />, href: '/overheads', keywords: ['overheads', 'rent', 'salaries', 'bills'] },
  { label: 'Hisaab / Ledger', group: 'Go to', icon: <BookUser className="h-4 w-4" />, href: '/hisaab', keywords: ['khata', 'ledger', 'accounts', 'owed'] },
  ...(STORE_PARTNERSHIP ? [{ label: 'Shareholder Finances', group: 'Go to', icon: <PieChart className="h-4 w-4" />, href: '/shareholders', keywords: ['shareholders', 'partners'] }] : []),
  { label: 'Analytics', group: 'Go to', icon: <TrendingUp className="h-4 w-4" />, href: '/analytics', keywords: ['reports', 'sales report'] },
  { label: 'Settings', group: 'Go to', icon: <SettingsIcon className="h-4 w-4" />, href: '/settings', keywords: ['gold rate', 'theme'] },
  { label: 'Payment Methods', group: 'Go to', icon: <Landmark className="h-4 w-4" />, href: '/settings/payment-methods', keywords: ['bank', 'payment'] },
  { label: 'Backups', group: 'Go to', icon: <ArchiveRestore className="h-4 w-4" />, href: '/settings/backups', keywords: ['backup', 'export'] },
  { label: 'Voice', group: 'Go to', icon: <Mic className="h-4 w-4" />, href: '/settings/voice', keywords: ['microphone'] },
  { label: 'Activity Log', group: 'Go to', icon: <History className="h-4 w-4" />, href: '/activity-log', keywords: ['history', 'who changed'] },
  { label: 'Recently removed', group: 'Go to', icon: <RotateCcw className="h-4 w-4" />, href: '/settings/recently-removed', keywords: ['deleted', 'trash', 'restore'] },
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

  const orders = useAppStore((s) => s.orders);
  const invoices = useAppStore((s) => s.generatedInvoices);
  const karigars = useAppStore((s) => s.karigars);
  const products = useAppStore((s) => s.products);
  const loadOrders = useAppStore((s) => s.loadOrders);
  const loadInvoices = useAppStore((s) => s.loadGeneratedInvoices);
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
    loadOrders();
    loadInvoices();
    loadKarigars();
    setQ('');
    setCursor(0);
  }, [open, loadOrders, loadInvoices, loadKarigars]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();

    const destinations: Item[] = [...NEW, ...DESTINATIONS].map((d, i) => ({ ...d, id: `d${i}` }));

    if (!needle) return destinations.slice(0, 10);

    const people: Array<{ item: Item; score: number; at?: string }> = [];

    const consider = (
      id: string,
      name: string,
      sub: string | undefined,
      group: string,
      icon: React.ReactNode,
      href: string,
      haystack: string,
      when?: string,
      exact = false,
    ) => {
      const hay = haystack.toLowerCase();
      const at = hay.indexOf(needle);
      if (exact) { people.push({ item: { id, label: name, sub, group, icon, href }, score: 5, at: when }); return; }
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
      people.push({ item: { id, label: name, sub, group, icon, href }, score, at: when });
    };


    // "31", "000031", "ord-31" or "inv-17" is that document's own number: it goes to the
    // top, above everything that merely has those digits in a phone number.
    // "inv"/"ord" in front narrows it to that kind.
    const numberQuery = /^(inv|ord|in|or|i|o)?[\s#-]*0*(\d+)$/.exec(needle);
    const wantKind = numberQuery?.[1]?.[0];            // 'i' | 'o' | undefined
    const wantNumber = numberQuery?.[2];
    const isNumber = (docId: string) => !!wantNumber
      && (!wantKind || docId.toLowerCase().startsWith(wantKind))
      && docId.replace(/\D/g, '').replace(/^0+/, '') === wantNumber;

    // Orders and invoices by the customer's name (or number, or phone).
    for (const o of orders) {
      const name = o.customerName || 'Walk-in customer';
      consider(
        `o${o.id}`,
        name,
        [o.id, shortDate(o.createdAt), o.status].filter(Boolean).join(' · '),
        'Orders',
        <ClipboardList className="h-4 w-4" />,
        `/orders/${o.id}`,
        `${name} ${o.id} ${phoneForms(o.customerContact)} ${o.summary ?? ''}`,
        o.createdAt,
        isNumber(o.id),
      );
    }
    for (const inv of invoices) {
      const name = inv.customerName || 'Walk-in customer';
      const due = Number(inv.balanceDue) || 0;
      consider(
        `i${inv.id}`,
        name,
        [inv.id, shortDate(inv.createdAt), due > 0 ? `${pkr(due)} due` : 'paid'].filter(Boolean).join(' · '),
        'Invoices',
        <Receipt className="h-4 w-4" />,
        `/cart?invoice_id=${inv.id}`,
        `${name} ${inv.id} ${phoneForms(inv.customerContact)}`,
        inv.createdAt,
        isNumber(inv.id),
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

    // A page by its name or by another word for it; a name that starts with what was
    // typed ranks above one that only contains it.
    const matchedDestinations = destinations
      .map((item) => {
        const label = item.label.toLowerCase();
        const words = (item as { keywords?: string[] }).keywords || [];
        const score = label.startsWith(needle) ? 4 : label.includes(needle) ? 3
          : words.some((k) => k.startsWith(needle)) ? 3 : words.some((k) => k.includes(needle)) ? 2.5 : -1;
        return { item, score };
      })
      .filter((x) => x.score > 0);

    // A document number typed exactly: show those documents alone, not every phone
    // number that happens to contain the digits.
    if (people.some(p => p.score >= 5)) {
      const exact = people.filter(p => p.score >= 5);
      people.length = 0;
      people.push(...exact);
    }

    // Best matches first, newest first among equals, then each group kept together
    // (a customer's three orders sit under one heading, not interleaved with invoices).
    const ranked = [...matchedDestinations, ...people]
      .sort((a, b) => (b.score - a.score) || ((b as { at?: string }).at || '').localeCompare((a as { at?: string }).at || ''))
      .slice(0, 40);
    const groupRank = new Map<string, number>();
    ranked.forEach((x, i) => { if (!groupRank.has(x.item.group)) groupRank.set(x.item.group, i * 10 + GROUP_ORDER.indexOf(x.item.group)); });
    return ranked
      .map((x, i) => ({ x, i }))
      .sort((a, b) => (groupRank.get(a.x.item.group)! - groupRank.get(b.x.item.group)!) || (a.i - b.i))
      .map(({ x }) => x.item);
  }, [q, orders, invoices, karigars, products]);

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
      {/* On a phone the palette is the whole screen (a centred box left the results under
          the keyboard) with Cancel in place of the small ×; from sm up it is the usual box. */}
      <DialogContent
        onKeyDown={onKeyDown}
        className={
          'max-w-xl gap-0 overflow-hidden p-0 flex flex-col '
          + 'max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:h-[100dvh] max-sm:max-w-none max-sm:rounded-none max-sm:border-0 '
          + 'max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-top-2 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-top-2 max-sm:data-[state=open]:zoom-in-100 '
          + 'max-sm:[&>button:last-child]:hidden'
        }
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-3 border-b px-4 max-sm:pt-[env(safe-area-inset-top)]">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find an order or invoice by name, or jump to a screen…"
            aria-label="Search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            // 16px on a phone: iOS zooms the page into any field smaller than that.
            className="h-14 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:h-12 sm:text-sm"
          />
          <button type="button" onClick={() => setOpen(false)} className="shrink-0 py-2 text-sm font-medium text-primary sm:hidden">
            Cancel
          </button>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto overscroll-contain p-2 max-sm:max-h-none max-sm:min-h-0 max-sm:flex-1 max-sm:pb-[max(env(safe-area-inset-bottom),0.5rem)]">
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
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-[15px] sm:py-2 sm:text-sm ${
                    i === cursor ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <span className="shrink-0 text-muted-foreground">{it.icon}</span>
                  {/* The details go under the name on a phone, beside it from sm up, so a
                      long name is never squeezed out by the order number and date. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.label}</span>
                    {it.sub && <span className="block truncate text-xs text-muted-foreground sm:hidden">{it.sub}</span>}
                  </span>
                  {it.sub && <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:block">{it.sub}</span>}
                  <ArrowRight className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="hidden gap-4 border-t px-4 py-2 text-xs text-muted-foreground sm:flex">
          <span>↑↓ move</span><span>↵ open</span><span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
