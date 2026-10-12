

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import Link from 'next/link';
import { useAppStore, Karigar } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LedgerHeading, Pill, Monogram, SearchField, Segmented, EmptyState, FigureTile } from '@/components/ledger';
import { buildWorkshopJobs, groupByKarigar, KarigarWorkload, CRITICAL_DAYS } from '@/lib/workshop';
import { PlusCircle, Edit3, Briefcase, Phone, Eye, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageShell } from '@/components/shared/page-shell';

/** What this karigar is holding, in one line. */
const BenchSummary: React.FC<{ load?: KarigarWorkload; compact?: boolean }> = ({ load, compact }) => {
  if (!load || load.active === 0) {
    return <span className="text-ios-sub text-muted-foreground">Free</span>;
  }
  const late = load.overdue - load.critical;
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span className="font-semibold tabular-nums">{load.active}</span>
      <span className="text-sm text-muted-foreground">piece{load.active === 1 ? '' : 's'}</span>
      {load.critical > 0 && (
        <Pill tone="late">{load.critical} over {CRITICAL_DAYS}d</Pill>
      )}
      {late > 0 && (
        <Pill tone="owed">{late} late</Pill>
      )}
      {!compact && load.totalWeightG > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">{load.totalWeightG.toFixed(1)}g out</span>
      )}
    </span>
  );
};

const KarigarCard: React.FC<{ karigar: Karigar; activeHisaab: string | null; load?: KarigarWorkload }> = ({ karigar, activeHisaab, load }) => (
  <Link href={`/karigars/${karigar.id}`}
    className="flex min-h-[56px] items-center gap-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
    <Monogram name={karigar.name} size={40} />
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-ios-headline font-semibold truncate">{karigar.name}</p>
        {activeHisaab && <Pill tone="house" className="flex-shrink-0">{activeHisaab}</Pill>}
      </div>
      <div className="mt-0.5"><BenchSummary load={load} compact /></div>
      {karigar.contact && <p className="text-ios-cap text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" />{karigar.contact}</p>}
    </div>
    <ChevronRight aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
  </Link>
);

const KarigarRow: React.FC<{ karigar: Karigar; activeHisaab: string | null; load?: KarigarWorkload }> = ({ karigar, activeHisaab, load }) => (
  <TableRow className="cursor-pointer">
    <TableCell>
      <Link href={`/karigars/${karigar.id}`} className="font-medium text-foreground hover:underline flex items-center gap-2">
        <Monogram name={karigar.name} size={32} />
        {karigar.name}
      </Link>
    </TableCell>
    <TableCell><BenchSummary load={load} /></TableCell>
    <TableCell className="text-muted-foreground hidden lg:table-cell">{karigar.contact || '-'}</TableCell>
    <TableCell className="hidden xl:table-cell">
      {activeHisaab
        ? <Pill tone="house">{activeHisaab}</Pill>
        : <span className="text-muted-foreground text-sm">—</span>}
    </TableCell>
    <TableCell className="text-right">
      <div className="flex justify-end gap-1">
        <Button asChild size="sm" variant="ghost" aria-label="View">
          <Link href={`/karigars/${karigar.id}`}><Eye className="w-4 h-4" /></Link>
        </Button>
        <Button asChild size="sm" variant="ghost" aria-label="Edit">
          <Link href={`/karigars/${karigar.id}/edit`}><Edit3 className="w-4 h-4" /></Link>
        </Button>
      </div>
    </TableCell>
  </TableRow>
);

export default function KarigarsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [lastAccessed, setLastAccessed] = useState<Record<string, number>>({});
  const [view, setView] = useState<'all' | 'working' | 'free'>('all');

  const appReady = useAppReady();

  useEffect(() => {
    try {
      setLastAccessed(JSON.parse(localStorage.getItem('karigar_accessed') || '{}'));
    } catch {}
  }, []);
  const karigars = useAppStore(state => state.karigars);
  const karigarBatches = useAppStore(state => state.karigarBatches);
  // This page was a phone book. What you actually want to know about a
  // karigar is what is on their bench right now.
  const orders = useAppStore(state => state.orders);
  const karigarJobs = useAppStore(state => state.karigarJobs);
  const invoices = useAppStore(state => state.generatedInvoices);
  const isKarigarsLoading = useAppStore(state => state.isKarigarsLoading);
  const { deleteKarigar: deleteKarigarAction, loadKarigars, loadKarigarBatches, loadOrders, loadKarigarJobs, loadGeneratedInvoices } = useAppStore();

  useEffect(() => {
    if (appReady) {
      loadKarigars();
      loadKarigarBatches();
      loadOrders();
      loadKarigarJobs();
      loadGeneratedInvoices();
    }
  }, [appReady, loadKarigars, loadKarigarBatches, loadOrders, loadKarigarJobs, loadGeneratedInvoices]);

  const loadById = useMemo(() => {
    const jobs = buildWorkshopJobs(orders, karigarJobs, karigars, { invoices });
    const map = new Map<string, KarigarWorkload>();
    for (const l of groupByKarigar(jobs)) map.set(l.karigarId, l);
    return map;
  }, [orders, karigarJobs, karigars, invoices]);

  const activeHisaabMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of karigarBatches) {
      if (!b.closedDate) map[b.karigarId] = b.label;
    }
    return map;
  }, [karigarBatches]);

  /** Who is working, who is free — the question this page exists to answer. */
  const groups = useMemo(() => {
    if (!appReady) return { working: [], free: [], all: [] as Karigar[] };
    const q = searchTerm.trim().toLowerCase();
    const matched = karigars.filter(k =>
      !q || k.name.toLowerCase().includes(q) || (k.contact || '').includes(searchTerm));

    const byRecency = (a: Karigar, b: Karigar) => {
      const ta = lastAccessed[a.id] || 0, tb = lastAccessed[b.id] || 0;
      if (ta !== tb) return tb - ta;
      return (a.name || '').localeCompare(b.name || '');
    };
    // Busiest first inside the working group: the one holding the most, and
    // the most overdue, is the one you need to look at.
    const byLoad = (a: Karigar, b: Karigar) => {
      const la = loadById.get(a.id), lb = loadById.get(b.id);
      const ca = la?.critical || 0, cb = lb?.critical || 0;
      if (ca !== cb) return cb - ca;
      const na = la?.active || 0, nb = lb?.active || 0;
      if (na !== nb) return nb - na;
      return (a.name || '').localeCompare(b.name || '');
    };

    const working = matched.filter(k => (loadById.get(k.id)?.active || 0) > 0).sort(byLoad);
    const free = matched.filter(k => (loadById.get(k.id)?.active || 0) === 0).sort(byRecency);
    return { working, free, all: matched };
  }, [karigars, searchTerm, appReady, lastAccessed, loadById]);

  const visible = view === 'working' ? { working: groups.working, free: [] }
    : view === 'free' ? { working: [], free: groups.free }
    : groups;

  const stats = useMemo(() => {
    let pieces = 0, critical = 0, grams = 0;
    for (const k of karigars) {
      const l = loadById.get(k.id);
      pieces += l?.active || 0;
      critical += l?.critical || 0;
      grams += l?.totalWeightG || 0;
    }
    return {
      total: karigars.length,
      working: karigars.filter(k => (loadById.get(k.id)?.active || 0) > 0).length,
      pieces, critical, grams,
      openHisaabs: Object.keys(activeHisaabMap).length,
    };
  }, [karigars, loadById, activeHisaabMap]);

  if (!appReady || isKarigarsLoading) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton rows={6} />
      </div>
    );
  }

  const Section: React.FC<{ title: string; hint: string; people: Karigar[] }> = ({ title, hint, people }) => {
    if (people.length === 0) return null;
    return (
      <section>
        <LedgerHeading title={title} count={people.length} trailing={hint} className="pb-2" />

        <div className="md:hidden overflow-hidden rounded-card bg-card divide-y divide-separator px-4">
          {people.map(k => (
            <KarigarCard key={k.id} karigar={k} activeHisaab={activeHisaabMap[k.id] ?? null}
              load={loadById.get(k.id)} />
          ))}
        </div>

        <Card className="hidden md:block">
          <CardContent className="p-0 scroll-shadow-x overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Currently assigned</TableHead>
                  <TableHead className="hidden lg:table-cell">Contact</TableHead>
                  <TableHead className="hidden xl:table-cell">Active hisaab</TableHead>
                  <TableHead className="text-right w-[7rem]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map(k => (
                  <KarigarRow key={k.id} karigar={k} activeHisaab={activeHisaabMap[k.id] ?? null}
                    load={loadById.get(k.id)} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    );
  };

  return (
    <PageShell
      subtitle={<>{stats.working} of {stats.total} working · {stats.pieces} piece{stats.pieces === 1 ? '' : 's'} out</>}
      action={
        <Button asChild size="sm" className="flex-shrink-0">
          <Link href="/karigars/add"><PlusCircle className="w-4 h-4 mr-2" />Add karigar</Link>
        </Button>
      }
    >

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <FigureTile label="Working now" value={String(stats.working)} detail={`of ${stats.total} on file`} />
        <FigureTile label="Pieces out" value={String(stats.pieces)} detail={stats.grams > 0 ? `${stats.grams.toFixed(0)}g of metal` : undefined} />
        <FigureTile label={`Over ${CRITICAL_DAYS} days`} value={String(stats.critical)} tint={stats.critical > 0 ? 'late' : undefined} />
        <FigureTile label="Open hisaabs" value={String(stats.openHisaabs)} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <SearchField value={searchTerm} onChange={setSearchTerm} placeholder="Search by name or contact…" className="sm:flex-1" />
        <Segmented<'all' | 'working' | 'free'> label="Show" value={view} onChange={setView} className="shrink-0"
          options={[{ value: 'all', label: 'Everyone' }, { value: 'working', label: 'Working' }, { value: 'free', label: 'Free' }]} />
      </div>

      {groups.all.length === 0 ? (
        <EmptyState icon={<Briefcase />} title="No karigars found"
          description={searchTerm ? 'Try a different search term.' : 'Add a karigar to begin.'} />
      ) : (
        <div className="space-y-[22px]">
          <Section title="Working" hint="busiest first" people={visible.working} />
          <Section title="Free" hint="nothing on the bench" people={visible.free} />
        </div>
      )}
    </PageShell>
  );
}
