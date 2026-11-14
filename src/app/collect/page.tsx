"use client";

/**
 * To collect: everyone who still owes the shop, one row per bill — invoices with a balance and completed orders not yet
 * invoiced (lib/collect.ts) — sorted oldest first, by amount, or by who took it, and narrowed to one person (the owner,
 * 2026-11-14: "create a separate page to see people who still owe money in invoices or completed orders. allow to sort by
 * who took the order"). Owners only: what customers owe is the books (docs/decisions.md#staff-see-no-money).
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { HandCoins } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/lib/store';
import { PageShell } from '@/components/shared/page-shell';
import { ListSkeleton } from '@/components/shared/skeletons';
import { ChipRow, ContactActions, EmptyState, FilterChip, LedgerSection, Monogram, Pill, Segmented } from '@/components/ledger';
import { byTakenBy, collectRows, NOBODY, sortRows, type CollectRow, type CollectSort } from '@/lib/collect';
import { lacCrore, pkrLac } from '@/lib/money';
import { formatDate } from '@/lib/safe-date';
import { differenceInCalendarDays, parseISO } from 'date-fns';

const who = (t: string) => t || 'Not recorded';

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
  const [person, setPerson] = useState<string | null>(null);

  const rows = useMemo(() => collectRows(generatedInvoices, orders), [generatedInvoices, orders]);
  const people = useMemo(() => byTakenBy(rows), [rows]);
  const shown = useMemo(() => sortRows(person === null ? rows : rows.filter(r => r.takenBy === person), sort), [rows, person, sort]);
  const total = rows.reduce((s, r) => s + r.due, 0);
  const shownTotal = shown.reduce((s, r) => s + r.due, 0);

  // Grouped under each person's name when sorted by who took it; one list otherwise.
  const groups = useMemo(() => {
    if (sort !== 'takenBy') return [{ key: 'all', title: person === null ? 'Everyone' : who(person), rows: shown }];
    const m = new Map<string, CollectRow[]>();
    for (const r of shown) m.set(r.takenBy, [...(m.get(r.takenBy) ?? []), r]);
    return people.filter(p => m.has(p.takenBy)).map(p => ({ key: p.takenBy || 'nobody', title: who(p.takenBy), rows: m.get(p.takenBy)! }));
  }, [sort, shown, people, person]);

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
            {person !== null && <span className="text-ios-foot text-muted-foreground tabular-nums">{who(person)}: {pkrLac(shownTotal)}</span>}
          </div>
          <ChipRow label="Taken by">
            <FilterChip title="Everyone" count={rows.length} chosen={person === null} onClick={() => setPerson(null)} />
            {people.map(p => (
              <FilterChip key={p.takenBy || NOBODY} title={`${who(p.takenBy)} · ${lacCrore(p.due)}`} count={p.count}
                chosen={person === p.takenBy} onClick={() => setPerson(person === p.takenBy ? null : p.takenBy)} />
            ))}
          </ChipRow>
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
