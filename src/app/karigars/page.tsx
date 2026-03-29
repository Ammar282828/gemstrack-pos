

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAppStore, Karigar } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, PlusCircle, Edit3, Briefcase, Phone, StickyNote, Loader2, Eye, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const KarigarCard: React.FC<{ karigar: Karigar; activeHisaab: string | null }> = ({ karigar, activeHisaab }) => (
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
            {karigar.contact && <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5"><Phone className="h-3 w-3" />{karigar.contact}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  </Link>
);

const KarigarRow: React.FC<{ karigar: Karigar; activeHisaab: string | null }> = ({ karigar, activeHisaab }) => (
  <TableRow className="cursor-pointer">
    <TableCell>
      <Link href={`/karigars/${karigar.id}`} className="font-medium text-primary hover:underline flex items-center gap-2">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="h-4 w-4 text-primary" />
        </div>
        {karigar.name}
      </Link>
    </TableCell>
    <TableCell className="text-muted-foreground">{karigar.contact || '-'}</TableCell>
    <TableCell>
      {activeHisaab
        ? <Badge className="text-xs">{activeHisaab}</Badge>
        : <span className="text-muted-foreground text-sm">—</span>}
    </TableCell>
    <TableCell className="text-right">
      <div className="flex justify-end gap-1">
        <Button asChild size="sm" variant="ghost">
          <Link href={`/karigars/${karigar.id}`}><Eye className="w-4 h-4" /></Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
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
  const isKarigarsLoading = useAppStore(state => state.isKarigarsLoading);
  const { deleteKarigar: deleteKarigarAction, loadKarigars, loadKarigarBatches } = useAppStore();
  const { toast } = useToast();

  useEffect(() => {
    if (appReady) {
      loadKarigars();
      loadKarigarBatches();
    }
  }, [appReady, loadKarigars, loadKarigarBatches]);

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
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading karigars...</p>
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

      <Card className="mb-5">
        <CardContent className="p-4">
          <div className="relative">
            <Input
              type="search"
              placeholder="Search by name or contact..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

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
              <KarigarCard key={k.id} karigar={k} activeHisaab={activeHisaabMap[k.id] ?? null} />
            ))}
          </div>
          {/* Desktop: Table */}
          <Card className="hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead><Phone className="inline mr-1 h-3.5 w-3.5" />Contact</TableHead>
                  <TableHead>Active Hisaab</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredKarigars.map(k => (
                  <KarigarRow key={k.id} karigar={k} activeHisaab={activeHisaabMap[k.id] ?? null} />
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
