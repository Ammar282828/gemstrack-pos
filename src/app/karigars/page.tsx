

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import { FilterBar } from '@/components/shared/filter-bar';
import Link from 'next/link';
import { useAppStore, Karigar } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { buildWorkshopJobs, groupByKarigar, KarigarWorkload, CRITICAL_DAYS } from '@/lib/workshop';
import { Search, PlusCircle, Edit3, Briefcase, Phone, StickyNote, Loader2, Eye, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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
  const { toast } = useToast();

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

  const filteredKarigars = useMemo(() => {
    if (!appReady) return [];
    return karigars
      .filter(k =>
        k.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (k.contact && k.contact.includes(searchTerm))
      )
      .sort((a, b) => {
        const ta = lastAccessed[a.id] || 0;
        const tb = lastAccessed[b.id] || 0;
        if (ta !== tb) return tb - ta;
        return a.name.localeCompare(b.name);
      });
  }, [karigars, searchTerm, appReady, lastAccessed]);

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 px-3 md:py-8 md:px-4">
      <header className="mb-4 md:mb-6 flex flex-row justify-between items-start gap-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-primary flex items-center"><Briefcase className="w-6 h-6 md:w-8 md:h-8 mr-2 md:mr-3 text-primary" />Karigars</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{karigars.length} artisan{karigars.length !== 1 ? 's' : ''}</p>
        </div>
        <Button asChild size="sm">
          <Link href="/karigars/add"><PlusCircle className="w-4 h-4 mr-2" />Add Karigar</Link>
        </Button>
      </header>

      <FilterBar value={searchTerm} onChange={setSearchTerm} placeholder="Search by name or contact…" />

      {isKarigarsLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      ) : filteredKarigars.length > 0 ? (
        <>
          {/* Mobile: Cards */}
          <div className="md:hidden">
            {filteredKarigars.map(k => (
              <KarigarCard key={k.id} karigar={k} activeHisaab={activeHisaabMap[k.id] ?? null}
                load={loadById.get(k.id)} />
            ))}
          </div>
          {/* Desktop: Table */}
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>On the bench</TableHead>
                  <TableHead className="hidden lg:table-cell"><Phone className="inline mr-1 h-3.5 w-3.5" />Contact</TableHead>
                  <TableHead className="hidden xl:table-cell">Active Hisaab</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredKarigars.map(k => (
                  <KarigarRow key={k.id} karigar={k} activeHisaab={activeHisaabMap[k.id] ?? null}
                    load={loadById.get(k.id)} />
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      ) : (
        <div className="text-center py-12 bg-card rounded-lg shadow">
          <Briefcase className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Karigars Found</h3>
          <p className="text-muted-foreground text-sm">
            {searchTerm ? "Try adjusting your search term." : "Add your first karigar to get started."}
          </p>
        </div>
      )}
    </div>
  );
}
