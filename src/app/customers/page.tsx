

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAppStore, Customer } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, PlusCircle, Edit3, Trash2, User, Phone, Mail, MapPin, Users, Loader2, BookUser, Merge } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';

const CustomerActions: React.FC<{ customer: Customer; onDelete: (id: string) => Promise<void>; isCard?: boolean }> = ({ customer, onDelete, isCard }) => {
  return (
    <div className="flex gap-2 w-full">
      <Button asChild size="sm" variant="outline" className="flex-1">
        <Link href={`/hisaab/${customer.id}?type=customer`}>
          <BookUser className="w-4 h-4 mr-1.5" /> Ledger
        </Link>
      </Button>
      <Button asChild size="sm" variant={isCard ? 'default' : 'outline'} className="flex-1">
        <Link href={`/customers/${customer.id}/edit`}>
          <Edit3 className="w-4 h-4 mr-1.5" /> Edit
        </Link>
      </Button>
    </div>
  );
}

const CustomerRow: React.FC<{ customer: Customer; onDelete: (id: string) => Promise<void> }> = ({ customer, onDelete }) => {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/customers/${customer.id}`} className="font-medium text-primary hover:underline">
          {customer.name}
        </Link>
      </TableCell>
      <TableCell>{customer.phone || '-'}</TableCell>
      <TableCell>{customer.email || '-'}</TableCell>
      <TableCell>{customer.address || '-'}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/hisaab/${customer.id}?type=customer`}>
              <BookUser className="w-4 h-4" />
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/customers/${customer.id}/edit`}>
              <Edit3 className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

const CustomerCard: React.FC<{ customer: Customer; onDelete: (id: string) => Promise<void> }> = ({ customer, onDelete }) => (
    <Card className="mb-4">
        <CardHeader>
             <Link href={`/customers/${customer.id}`} className="font-bold text-primary hover:underline">
                <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5"/>
                    {customer.name}
                </CardTitle>
            </Link>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
            {customer.phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4"/><span>{customer.phone}</span></div>}
            {customer.email && <div className="flex items-center gap-2"><Mail className="w-4 h-4"/><span>{customer.email}</span></div>}
            {customer.address && <div className="flex items-start gap-2"><MapPin className="w-4 h-4 mt-1 flex-shrink-0"/><span>{customer.address}</span></div>}
        </CardContent>
        <CardFooter className="p-2 border-t bg-muted/30">
            <CustomerActions customer={customer} onDelete={onDelete} isCard />
        </CardFooter>
    </Card>
);


// --- Duplicate detection helpers ---
function normalizeName(name: string) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}
function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '').replace(/^0+/, '');
}
function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a), nb = normalizeName(b);
  if (na === nb) return 1;
  // Check if one contains the other
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  // Word overlap
  const wa = new Set(na.split(' ')), wb = new Set(nb.split(' '));
  const inter = [...wa].filter(w => wb.has(w)).length;
  return inter / Math.max(wa.size, wb.size);
}
interface DuplicatePair {
  a: Customer;
  b: Customer;
  reason: string;
  score: number;
}
function detectDuplicates(customers: Customer[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const a = customers[i], b = customers[j];
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      // Same phone
      if (a.phone && b.phone) {
        const pa = normalizePhone(a.phone), pb = normalizePhone(b.phone);
        if (pa && pb && pa === pb) {
          seen.add(key);
          pairs.push({ a, b, reason: 'Same phone number', score: 1 });
          continue;
        }
      }
      // Similar name
      const sim = nameSimilarity(a.name, b.name);
      if (sim >= 0.85) {
        seen.add(key);
        pairs.push({ a, b, reason: `Similar name (${Math.round(sim * 100)}% match)`, score: sim });
      }
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

// --- Merge Duplicates Dialog ---
const MergeCustomersDialog: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customers: Customer[];
  onMerge: (keepId: string, deleteId: string) => Promise<void>;
}> = ({ open, onOpenChange, customers, onMerge }) => {
  const [mergingPairKey, setMergingPairKey] = useState<string | null>(null);
  const [swapped, setSwapped] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [manualKeepSearch, setManualKeepSearch] = useState('');
  const [manualDeleteSearch, setManualDeleteSearch] = useState('');
  const [manualKeepId, setManualKeepId] = useState('');
  const [manualDeleteId, setManualDeleteId] = useState('');
  const [isMergingManual, setIsMergingManual] = useState(false);

  const pairs = useMemo(() => detectDuplicates(customers), [customers]);
  const visiblePairs = pairs.filter(p => {
    const key = [p.a.id, p.b.id].sort().join('|');
    return !dismissed.has(key);
  });

  const handleMergePair = async (pair: DuplicatePair) => {
    const key = [pair.a.id, pair.b.id].sort().join('|');
    const isSwapped = swapped.has(key);
    const keepId = isSwapped ? pair.b.id : pair.a.id;
    const deleteId = isSwapped ? pair.a.id : pair.b.id;
    setMergingPairKey(key);
    try {
      await onMerge(keepId, deleteId);
      setDismissed(prev => new Set(prev).add(key));
    } finally {
      setMergingPairKey(null);
    }
  };

  const handleSwap = (pair: DuplicatePair) => {
    const key = [pair.a.id, pair.b.id].sort().join('|');
    setSwapped(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleDismiss = (pair: DuplicatePair) => {
    const key = [pair.a.id, pair.b.id].sort().join('|');
    setDismissed(prev => new Set(prev).add(key));
  };

  // Manual search
  const manualKeepCustomer = customers.find(c => c.id === manualKeepId);
  const manualDeleteCustomer = customers.find(c => c.id === manualDeleteId);
  const manualKeepResults = useMemo(() =>
    manualKeepSearch.trim().length > 1
      ? customers.filter(c => c.id !== manualDeleteId && (c.name.toLowerCase().includes(manualKeepSearch.toLowerCase()) || (c.phone && c.phone.includes(manualKeepSearch)))).slice(0, 6)
      : [], [customers, manualKeepSearch, manualDeleteId]);
  const manualDeleteResults = useMemo(() =>
    manualDeleteSearch.trim().length > 1
      ? customers.filter(c => c.id !== manualKeepId && (c.name.toLowerCase().includes(manualDeleteSearch.toLowerCase()) || (c.phone && c.phone.includes(manualDeleteSearch)))).slice(0, 6)
      : [], [customers, manualDeleteSearch, manualKeepId]);

  const handleMergeManual = async () => {
    if (!manualKeepId || !manualDeleteId || manualKeepId === manualDeleteId) return;
    setIsMergingManual(true);
    try {
      await onMerge(manualKeepId, manualDeleteId);
      setManualKeepId(''); setManualDeleteId(''); setManualKeepSearch(''); setManualDeleteSearch('');
    } finally {
      setIsMergingManual(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Merge className="w-5 h-5"/>Merge Duplicate Customers</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 space-y-4 pr-1">
          {/* Auto-detected pairs */}
          {visiblePairs.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">{visiblePairs.length} potential duplicate{visiblePairs.length > 1 ? 's' : ''} detected</p>
              {visiblePairs.map(pair => {
                const key = [pair.a.id, pair.b.id].sort().join('|');
                const isSwapped = swapped.has(key);
                const keep = isSwapped ? pair.b : pair.a;
                const del = isSwapped ? pair.a : pair.b;
                const isMerging = mergingPairKey === key;
                return (
                  <div key={key} className="border rounded-lg p-3 space-y-2 bg-card">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">{pair.reason}</Badge>
                      <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => handleDismiss(pair)}>Dismiss</button>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center text-sm">
                      <div className="min-w-0 bg-primary/5 rounded p-2">
                        <p className="text-xs font-semibold text-primary mb-0.5">KEEP</p>
                        <p className="font-medium truncate">{keep.name}</p>
                        {keep.phone && <p className="text-xs text-muted-foreground">{keep.phone}</p>}
                      </div>
                      <button
                        className="text-muted-foreground hover:text-foreground text-lg px-1 flex-shrink-0 rotate-90"
                        title="Swap keep/delete"
                        onClick={() => handleSwap(pair)}
                      >⇄</button>
                      <div className="min-w-0 bg-destructive/5 rounded p-2">
                        <p className="text-xs font-semibold text-destructive mb-0.5">DELETE</p>
                        <p className="font-medium truncate">{del.name}</p>
                        {del.phone && <p className="text-xs text-muted-foreground">{del.phone}</p>}
                      </div>
                    </div>
                    <Button size="sm" variant="destructive" className="w-full" disabled={isMerging} onClick={() => handleMergePair(pair)}>
                      {isMerging ? <><Loader2 className="w-3 h-3 mr-2 animate-spin"/>Merging...</> : 'Merge & Delete Duplicate'}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No duplicates auto-detected.</p>
          )}

          {/* Manual merge */}
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium">Manual merge</p>
            <div>
              <label className="text-xs font-medium text-primary">Keep (primary)</label>
              <Input placeholder="Search by name or phone..." value={manualKeepCustomer ? manualKeepCustomer.name : manualKeepSearch} onChange={e => { setManualKeepId(''); setManualKeepSearch(e.target.value); }} className="mt-1 h-8 text-sm" />
              {manualKeepResults.length > 0 && !manualKeepCustomer && (
                <div className="border rounded-md mt-1 divide-y max-h-32 overflow-y-auto">
                  {manualKeepResults.map(c => (
                    <button key={c.id} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex justify-between" onClick={() => { setManualKeepId(c.id); setManualKeepSearch(''); }}>
                      <span>{c.name}</span><span className="text-muted-foreground text-xs">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {manualKeepCustomer && <div className="mt-1 flex items-center gap-2"><Badge variant="default" className="text-xs">{manualKeepCustomer.name}</Badge><button className="text-xs text-muted-foreground underline ml-auto" onClick={() => { setManualKeepId(''); setManualKeepSearch(''); }}>Clear</button></div>}
            </div>
            <div>
              <label className="text-xs font-medium text-destructive">Duplicate (will be deleted)</label>
              <Input placeholder="Search by name or phone..." value={manualDeleteCustomer ? manualDeleteCustomer.name : manualDeleteSearch} onChange={e => { setManualDeleteId(''); setManualDeleteSearch(e.target.value); }} className="mt-1 h-8 text-sm border-destructive/40" />
              {manualDeleteResults.length > 0 && !manualDeleteCustomer && (
                <div className="border rounded-md mt-1 divide-y max-h-32 overflow-y-auto">
                  {manualDeleteResults.map(c => (
                    <button key={c.id} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex justify-between" onClick={() => { setManualDeleteId(c.id); setManualDeleteSearch(''); }}>
                      <span>{c.name}</span><span className="text-muted-foreground text-xs">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              {manualDeleteCustomer && <div className="mt-1 flex items-center gap-2"><Badge variant="destructive" className="text-xs">{manualDeleteCustomer.name}</Badge><button className="text-xs text-muted-foreground underline ml-auto" onClick={() => { setManualDeleteId(''); setManualDeleteSearch(''); }}>Clear</button></div>}
            </div>
            <Button size="sm" variant="destructive" className="w-full" disabled={!manualKeepId || !manualDeleteId || manualKeepId === manualDeleteId || isMergingManual} onClick={handleMergeManual}>
              {isMergingManual ? <><Loader2 className="w-3 h-3 mr-2 animate-spin"/>Merging...</> : 'Merge & Delete Duplicate'}
            </Button>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default function CustomersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  
  const appReady = useAppReady();
  const { customers, deleteCustomerAction, isCustomersLoading, loadCustomers, mergeCustomers } = useAppStore(state => ({
    customers: state.customers,
    deleteCustomerAction: state.deleteCustomer,
    isCustomersLoading: state.isCustomersLoading,
    loadCustomers: state.loadCustomers,
    mergeCustomers: state.mergeCustomers,
  }));
  const { toast } = useToast();

  useEffect(() => {
    if (appReady) {
      loadCustomers();
    }
  }, [appReady, loadCustomers]);


  const handleDeleteCustomer = async (id: string) => {
    await deleteCustomerAction(id);
    toast({ title: "Customer Deleted", description: `Customer has been deleted.` });
  };

  const handleMerge = async (keepId: string, deleteId: string) => {
    const result = await mergeCustomers(keepId, deleteId);
    toast({ title: "Customers Merged", description: `Duplicate removed. ${result.updatedDocs} records updated.` });
  };

  const filteredCustomers = useMemo(() => {
    if (!appReady) return [];
    return customers.filter(customer =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (customer.phone && customer.phone.includes(searchTerm)) ||
      (customer.email && customer.email.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [customers, searchTerm, appReady]);

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading customers...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 px-3 md:py-8 md:px-4">
      <MergeCustomersDialog open={mergeOpen} onOpenChange={setMergeOpen} customers={customers} onMerge={handleMerge} />

      <header className="mb-4 md:mb-6 flex flex-row justify-between items-start gap-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-primary flex items-center"><Users className="w-6 h-6 md:w-8 md:h-8 mr-2 md:mr-3"/>Customers</h1>
          <p className="text-sm text-muted-foreground">{customers.length} customer{customers.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
            <Merge className="w-4 h-4 mr-2" />Merge Duplicates
          </Button>
          <Button asChild size="sm">
            <Link href="/customers/add"><PlusCircle className="w-4 h-4 mr-2" />Add Customer</Link>
          </Button>
        </div>
      </header>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="relative flex-grow w-full">
            <Input
              type="search"
              placeholder="Search by name, phone, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      {isCustomersLoading ? (
         <div className="text-center py-12">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Refreshing customer list...</p>
         </div>
      ) : filteredCustomers.length > 0 ? (
        <>
            {/* Mobile View: Cards */}
            <div className="md:hidden">
                {filteredCustomers.map((customer) => (
                    <CustomerCard key={customer.id} customer={customer} onDelete={handleDeleteCustomer} />
                ))}
            </div>

            {/* Desktop View: Table */}
            <Card className="hidden md:block">
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead><User className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Name</TableHead>
                    <TableHead><Phone className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Phone</TableHead>
                    <TableHead><Mail className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Email</TableHead>
                    <TableHead><MapPin className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Address</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {filteredCustomers.map((customer) => (
                    <CustomerRow key={customer.id} customer={customer} onDelete={handleDeleteCustomer} />
                ))}
                </TableBody>
            </Table>
            </Card>
        </>
      ) : (
        <div className="text-center py-12 bg-card rounded-lg shadow">
          <Users className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Customers Found</h3>
          <p className="text-muted-foreground">
            {searchTerm ? "Try adjusting your search term." : "Add some customers to get started!"}
          </p>
        </div>
      )}
    </div>
  );
}
