"use client";

/**
 * To collect: everyone who still owes the shop, one row per bill — invoices with a balance and completed orders not yet
 * invoiced (lib/collect.ts) — sorted oldest first, by amount, or by who took it, and narrowed to some of the people (the owner,
 * 2026-11-14: "create a separate page to see people who still owe money in invoices or completed orders. allow to sort by
 * who took the order"), and filtered several ways at once with the person who took it the main filter (same day: "allow
 * multi-filtering. Just keep the main filter as the person who took the order"). Owners only: what customers owe is the books (docs/decisions.md#staff-see-no-money).
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { HandCoins, Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/lib/store';
import { PageShell } from '@/components/shared/page-shell';
import { ListSkeleton } from '@/components/shared/skeletons';
import { ChipRow, ContactActions, EmptyState, FilterChip, LedgerSection, Monogram, Pill, Segmented } from '@/components/ledger';
import {
  ageOf, byTakenBy, collectRows, countBy, filterRows, filtersOn, NO_FILTERS, NOBODY, paidOf, sortRows,
  type CollectAge, type CollectFilters, type CollectKind, type CollectPaid, type CollectRow, type CollectSort,
} from '@/lib/collect';
import { lacCrore, pkrLac } from '@/lib/money';
import { formatDate } from '@/lib/safe-date';
import { differenceInCalendarDays, parseISO } from 'date-fns';

const who = (t: string) => t || 'Not recorded';

const KINDS: [CollectKind, string][] = [['invoice', 'Invoices'], ['order', 'Completed orders']];
const AGES: [CollectAge, string][] = [['under30', 'Under 30 days'], ['30to90', '30–90 days'], ['over90', 'Over 90 days']];
const PAIDS: [CollectPaid, string][] = [['nothing', 'Nothing paid'], ['part', 'Part paid']];

/** A set with one value added or taken away. */
function toggle<T>(set: ReadonlySet<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v); else next.add(v);
  return next;
}

const Divider = () => <span aria-hidden className="mx-1 h-6 w-px shrink-0 self-center bg-border" />;

function Row({ r }: { r: CollectRow }) {
  const days = differenceInCalendarDays(new Date(), parseISO(r.date));
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Monogram name={r.customerName} size={40} />
      <Link href={r.href} className="min-w-0 flex-1">
        <span className="block truncate text-ios-sub font-semibold text-foreground">{r.customerName}</span>
        <span className="block truncate text-ios-foot text-muted-foreground">
          {r.kind === 'invoice' ? 'Invoice' : 'Order'} {r.id} · {formatDate(r.date, 'd MMM yyyy')}
          {days > 0 ? ` · ${days} day${days === 1 ? '' : 's'}` : ''} · {who(r.takenBy)}
        </span>
      </Link>
      <span className="flex flex-shrink-0 flex-col items-end gap-1">
        <span className="text-ios-sub font-semibold tabular-nums">{lacCrore(r.due)}</span>
        <Pill tone={days > 30 ? 'late' : 'owed'}>{r.due >= r.total ? 'Unpaid' : `of ${lacCrore(r.total)}`}</Pill>
      </span>
      {r.phone && <ContactActions phone={r.phone} className="hidden sm:flex" />}
    </div>
  );
}

export default function CollectPage() {
  const { generatedInvoices, orders, isInvoicesLoading, isOrdersLoading, loadGeneratedInvoices, loadOrders } = useAppStore(useShallow(s => ({
    generatedInvoices: s.generatedInvoices, orders: s.orders, isInvoicesLoading: s.isInvoicesLoading, isOrdersLoading: s.isOrdersLoading,
    loadGeneratedInvoices: s.loadGeneratedInvoices, loadOrders: s.loadOrders,
  })));
  useEffect(() => { loadGeneratedInvoices(); loadOrders(); }, [loadGeneratedInvoices, loadOrders]);

  const [sort, setSort] = useState<CollectSort>('takenBy');
  const [f, setF] = useState<CollectFilters>(NO_FILTERS);
  const set = <K extends keyof CollectFilters>(k: K, v: CollectFilters[K]) => setF(prev => ({ ...prev, [k]: v }));

  const rows = useMemo(() => collectRows(generatedInvoices, orders), [generatedInvoices, orders]);
  // Every person who has anything owing, in the order of what they are owed, so the chips never jump about as filters change.
  const people = useMemo(() => byTakenBy(rows), [rows]);
  const shown = useMemo(() => sortRows(filterRows(rows, f), sort), [rows, f, sort]);
  // What each chip would show, with the other filters on.
  const perPerson = useMemo(() => countBy(rows, f, 'people', r => r.takenBy), [rows, f]);
  const perKind = useMemo(() => countBy(rows, f, 'kinds', r => r.kind), [rows, f]);
  const perAge = useMemo(() => countBy(rows, f, 'ages', r => ageOf(r)), [rows, f]);
  const perPaid = useMemo(() => countBy(rows, f, 'paid', paidOf), [rows, f]);
  const total = rows.reduce((s, r) => s + r.due, 0);
  const shownTotal = shown.reduce((s, r) => s + r.due, 0);
  const on = filtersOn(f);

  // Grouped under each person's name when sorted by who took it; one list otherwise.
  const groups = useMemo(() => {
    if (sort !== 'takenBy') {
      const title = f.people.size === 1 ? who([...f.people][0]) : on ? 'Filtered' : 'Everyone';
      return [{ key: 'all', title, rows: shown }];
    }
    const m = new Map<string, CollectRow[]>();
    for (const r of shown) m.set(r.takenBy, [...(m.get(r.takenBy) ?? []), r]);
    return people.filter(p => m.has(p.takenBy)).map(p => ({ key: p.takenBy || 'nobody', title: who(p.takenBy), rows: m.get(p.takenBy)! }));
  }, [sort, shown, people, f.people, on]);

  const loading = (isInvoicesLoading || isOrdersLoading) && rows.length === 0;

  return (
    <PageShell
      title="To collect"
      icon={<HandCoins className="h-6 w-6" />}
      subtitle={loading ? 'Reading the bills…' : rows.length ? `${pkrLac(total)} owed on ${rows.length} bill${rows.length === 1 ? '' : 's'}` : 'Nothing owed'}
    >
      {loading ? <ListSkeleton /> : rows.length === 0 ? (
        <EmptyState icon={<HandCoins />} title="Nobody owes anything" description="Every invoice and completed order is paid." className="py-12" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented<CollectSort> label="Sort by" value={sort} onChange={setSort}
              options={[{ value: 'takenBy', label: 'Taken by' }, { value: 'oldest', label: 'Oldest' }, { value: 'amount', label: 'Largest' }]} />
            {on > 0 && (
              <span className="flex items-center gap-2 text-ios-foot text-muted-foreground tabular-nums">
                {shown.length} of {rows.length} · {pkrLac(shownTotal)}
                <button type="button" onClick={() => setF(NO_FILTERS)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-semibold text-foreground active:opacity-70">
                  <X className="h-3.5 w-3.5" aria-hidden /> Clear
                </button>
              </span>
            )}
          </div>

          {/* The main filter: who took it. Several may be chosen; Everyone clears them. */}
          <div className="space-y-2">
            <h2 className="px-1 text-ios-cap font-semibold uppercase tracking-[.8px] text-muted-foreground">Taken by</h2>
            <ChipRow label="Taken by">
              <FilterChip title="Everyone" chosen={f.people.size === 0} onClick={() => set('people', new Set())} />
              {people.map(p => {
                const c = perPerson.get(p.takenBy);
                const chosen = f.people.has(p.takenBy);
                return (
                  <FilterChip key={p.takenBy || NOBODY} title={`${who(p.takenBy)} · ${lacCrore(c?.due ?? 0)}`} count={c?.count ?? 0}
                    chosen={chosen} onClick={() => set('people', toggle(f.people, p.takenBy))}
                    className={!chosen && !c ? 'opacity-50' : undefined} />
                );
              })}
            </ChipRow>
          </div>

          {/* Then narrow it: the bill, how long it has waited, whether anything was paid, a name. */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 rounded-full bg-card px-4 py-2.5">
              <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
              <input value={f.query} onChange={e => set('query', e.target.value)} placeholder="Customer, number or bill"
                className="min-w-0 flex-1 bg-transparent text-ios-sub outline-none placeholder:text-muted-foreground" aria-label="Search the bills" />
              {f.query && <button type="button" onClick={() => set('query', '')} aria-label="Clear the search"><X className="h-4 w-4 text-muted-foreground" /></button>}
            </label>
            <ChipRow label="Filters">
              {KINDS.map(([v, l]) => <FilterChip key={v} title={l} count={perKind.get(v)?.count ?? 0} chosen={f.kinds.has(v)} onClick={() => set('kinds', toggle(f.kinds, v))} />)}
              <Divider />
              {AGES.map(([v, l]) => <FilterChip key={v} title={l} count={perAge.get(v)?.count ?? 0} chosen={f.ages.has(v)} onClick={() => set('ages', toggle(f.ages, v))} />)}
              <Divider />
              {PAIDS.map(([v, l]) => <FilterChip key={v} title={l} count={perPaid.get(v)?.count ?? 0} chosen={f.paid.has(v)} onClick={() => set('paid', toggle(f.paid, v))} />)}
            </ChipRow>
          </div>

          {shown.length === 0 && (
            <EmptyState icon={<HandCoins />} title="Nothing matches" description="No bill passes all of these filters." className="py-10"
              action={<button type="button" onClick={() => setF(NO_FILTERS)} className="rounded-full bg-primary/[.12] px-4 py-2 text-ios-sub font-semibold text-primary">Clear filters</button>} />
          )}
          {groups.map(g => (
            <LedgerSection key={g.key} title={g.title} count={g.rows.length}
              trailing={<span className="text-ios-foot font-semibold tabular-nums text-muted-foreground">{lacCrore(g.rows.reduce((s, r) => s + r.due, 0))}</span>}>
              {g.rows.map(r => <Row key={`${r.kind}-${r.id}`} r={r} />)}
            </LedgerSection>
          ))}
        </div>
      )}
    </PageShell>
  );
}
