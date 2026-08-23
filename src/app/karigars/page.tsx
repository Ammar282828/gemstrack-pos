

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import { FilterBar } from '@/components/shared/filter-bar';
import Link from 'next/link';
import { useAppStore, Karigar } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { buildWorkshopJobs, groupByKarigar, KarigarWorkload, CRITICAL_DAYS } from '@/lib/workshop';
import { Search, PlusCircle, Edit3, Briefcase, Phone, Eye, User } from 'lucide-react';
import { cn } from '@/lib/utils';

/** What this karigar is holding, in one line. */
const BenchSummary: React.FC<{ load?: KarigarWorkload; compact?: boolean }> = ({ load, compact }) => {
  if (!load || load.active === 0) {
    return <span className="text-sm text-muted-foreground">Free</span>;
  }
  const late = load.overdue - load.critical;
  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <span className="font-semibold tabular-nums">{load.active}</span>
      <span className="text-sm text-muted-foreground">piece{load.active === 1 ? '' : 's'}</span>
      {load.critical > 0 && (
        <Badge variant="destructive" className="text-2xs">{load.critical} over {CRITICAL_DAYS}d</Badge>
      )}
      {late > 0 && (
        <Badge variant="outline" className="text-2xs text-warning border-warning/40 bg-warning/10">{late} late</Badge>
      )}
      {!compact && load.totalWeightG > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">{load.totalWeightG.toFixed(1)}g out</span>
      )}
    </span>
  );
};

const KarigarCard: React.FC<{ karigar: Karigar; activeHisaab: string | null; load?: KarigarWorkload }> = ({ karigar, activeHisaab, load }) => (
  <Link href={`/karigars/${karigar.id}`}>
    <Card className="mb-3 hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold truncate">{karigar.name}</p>
              {activeHisaab && <Badge className="text-xs flex-shrink-0">{activeHisaab}</Badge>}
            </div>
            <div className="mt-1"><BenchSummary load={load} compact /></div>
            {karigar.contact && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" />{karigar.contact}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  </Link>
);

const KarigarRow: React.FC<{ karigar: Karigar; activeHisaab: string | null; load?: KarigarWorkload }> = ({ karigar, activeHisaab, load }) => (
  <TableRow className="cursor-pointer">
    <TableCell>
      <Link href={`/karigars/${karigar.id}`} className="font-medium text-primary hover:underline flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="h-4 w-4 text-primary" />
        </div>
        {karigar.name}
      </Link>
    </TableCell>
    <TableCell><BenchSummary load={load} /></TableCell>
    <TableCell className="text-muted-foreground hidden lg:table-cell">{karigar.contact || '-'}</TableCell>
    <TableCell className="hidden xl:table-cell">
      {activeHisaab
        ? <Badge className="text-xs">{activeHisaab}</Badge>
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
        <div className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-sm font-semibold truncate">{title}</h2>
            <span className="text-2xs text-muted-foreground flex-shrink-0">{hint}</span>
          </div>
          <span className="text-2xs text-muted-foreground flex-shrink-0">{people.length}</span>
        </div>

        <div className="md:hidden">
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
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5">
            <Briefcase className="w-7 h-7 flex-shrink-0" />Karigars
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {stats.working} of {stats.total} working · {stats.pieces} piece{stats.pieces === 1 ? '' : 's'} out
          </p>
        </div>
        <Button asChild size="sm" className="flex-shrink-0">
          <Link href="/karigars/add"><PlusCircle className="w-4 h-4 mr-2" />Add karigar</Link>
        </Button>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Working now</p>
          <p className="text-base sm:text-xl md:text-2xl font-bold text-primary leading-tight">{stats.working}</p>
          <p className="text-2xs text-muted-foreground">of {stats.total} on file</p>
        </div>
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Pieces out</p>
          <p className="text-base sm:text-xl md:text-2xl font-bold leading-tight">{stats.pieces}</p>
          {stats.grams > 0 && <p className="text-2xs text-muted-foreground">{stats.grams.toFixed(0)}g of metal</p>}
        </div>
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Over {CRITICAL_DAYS} days</p>
          <p className={cn('text-base sm:text-xl md:text-2xl font-bold leading-tight',
            stats.critical > 0 && 'text-destructive')}>{stats.critical}</p>
        </div>
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Open hisaabs</p>
          <p className="text-base sm:text-xl md:text-2xl font-bold leading-tight">{stats.openHisaabs}</p>
        </div>
      </div>

      <FilterBar
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search by name or contact…"
        actions={
          <div className="inline-flex rounded-md border overflow-hidden flex-shrink-0" role="group" aria-label="Show">
            {([['all', 'Everyone'], ['working', 'Working'], ['free', 'Free']] as const).map(([id, label]) => (
              <button
                key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id}
                className={cn('px-2.5 text-xs h-9 transition-colors whitespace-nowrap',
                  view === id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {groups.all.length === 0 ? (
        <div className="text-center py-14 bg-card rounded-xl border">
          <Briefcase className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">No karigars found</h3>
          <p className="text-sm text-muted-foreground">
            {searchTerm ? 'Try a different search term.' : 'Add a karigar to begin.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Section title="Working" hint="busiest first" people={visible.working} />
          <Section title="Free" hint="nothing on the bench" people={visible.free} />
        </div>
      )}
    </div>
  );
}
