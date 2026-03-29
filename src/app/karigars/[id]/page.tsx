

"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppStore, Expense, KarigarBatch } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Edit3, Trash2, ArrowLeft, User, Phone, StickyNote,
  PlusCircle, Banknote, CheckCircle2, ChevronDown, ChevronUp, Lock, Unlock, History
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ExpenseForm } from '@/components/expense/expense-form';

const ClosedBatchCard: React.FC<{
  batch: KarigarBatch;
  expenses: Expense[];
  onDelete: (batchId: string) => void;
}> = ({ batch, expenses, onDelete }) => {
  const [open, setOpen] = useState(false);
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  return (
    <Card className="border-muted">
      <CardHeader
        className="flex flex-row items-center justify-between cursor-pointer select-none py-3 px-4"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-semibold text-sm">{batch.label}</p>
            <p className="text-xs text-muted-foreground">
              {format(parseISO(batch.startDate), 'dd MMM yyyy')}
              {batch.closedDate ? ` → ${format(parseISO(batch.closedDate), 'dd MMM yyyy')}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-sm font-bold">PKR {total.toLocaleString()}</Badge>
          <Badge variant="outline" className="text-xs">{expenses.length} payment{expenses.length !== 1 ? 's' : ''}</Badge>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="pt-0 pb-3 px-4">
          <Separator className="mb-3" />
          {expenses.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Description</TableHead>
                  <TableHead>Category</TableHead><TableHead className="text-right">PKR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-sm">{format(parseISO(e.date), 'dd MMM yy')}</TableCell>
                    <TableCell className="text-sm">{e.description}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.category}</TableCell>
                    <TableCell className="text-right font-medium text-sm">{e.amount.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-2">No payments in this batch.</p>
          )}
          <div className="flex justify-end mt-3">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive text-xs">
                  <Trash2 className="h-3 w-3 mr-1" />Delete Batch
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{batch.label}"?</AlertDialogTitle>
                  <AlertDialogDescription>This deletes the batch record. Payments will remain in expenses but will be unassigned.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(batch.id)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

const PreHisaabCard: React.FC<{ expenses: Expense[] }> = ({ expenses }) => {
  const [open, setOpen] = useState(false);
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  return (
    <Card className="border-muted bg-muted/10">
      <CardHeader
        className="flex flex-row items-center justify-between cursor-pointer select-none py-3 px-4"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-3">
          <History className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="font-semibold text-sm">Pre-Hisaab</p>
            <p className="text-xs text-muted-foreground">Recorded before the batch system</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-sm font-bold">PKR {total.toLocaleString()}</Badge>
          <Badge variant="outline" className="text-xs">{expenses.length} payment{expenses.length !== 1 ? 's' : ''}</Badge>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="pt-0 pb-3 px-4">
          <Separator className="mb-3" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Description</TableHead>
                <TableHead>Category</TableHead><TableHead className="text-right">PKR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-sm">{format(parseISO(e.date), 'dd MMM yy')}</TableCell>
                  <TableCell className="text-sm">{e.description}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{e.category}</TableCell>
                  <TableCell className="text-right font-medium text-sm">{e.amount.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}
    </Card>
  );
};

export default function KarigarDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const karigarId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const karigar = useAppStore(state => state.karigars.find(k => k.id === karigarId));
  const expenses = useAppStore(state => state.expenses);
  const karigarBatches = useAppStore(state => state.karigarBatches);
  const deleteKarigarAction = useAppStore(state => state.deleteKarigar);
  const { loadExpenses, loadKarigarBatches, createKarigarBatch, closeKarigarBatch, deleteKarigarBatch, loadKarigars } = useAppStore();

  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
  const [isNewBatchOpen, setIsNewBatchOpen] = useState(false);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [newBatchLabel, setNewBatchLabel] = useState('');
  const [carryOverLabel, setCarryOverLabel] = useState('');

  useEffect(() => {
    loadExpenses();
    loadKarigarBatches();
    loadKarigars();
  }, [loadExpenses, loadKarigarBatches, loadKarigars]);

  useEffect(() => {
    if (!karigarId) return;
    try {
      const stored = JSON.parse(localStorage.getItem('karigar_accessed') || '{}');
      stored[karigarId] = Date.now();
      localStorage.setItem('karigar_accessed', JSON.stringify(stored));
    } catch {}
  }, [karigarId]);

  const allKarigarExpenses = useMemo(() =>
    expenses.filter(e => e.karigarId === karigarId),
    [expenses, karigarId]
  );

  const myBatches = useMemo(() =>
    karigarBatches
      .filter(b => b.karigarId === karigarId)
      .sort((a, b) => parseISO(b.startDate).getTime() - parseISO(a.startDate).getTime()),
    [karigarBatches, karigarId]
  );

  const openBatch = myBatches.find(b => !b.closedDate);
  const closedBatches = myBatches.filter(b => !!b.closedDate);

  const openBatchExpenses = useMemo(() =>
    allKarigarExpenses
      .filter(e => openBatch ? e.batchId === openBatch.id : false)
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()),
    [allKarigarExpenses, openBatch]
  );

  const unbatchedExpenses = useMemo(() =>
    allKarigarExpenses
      .filter(e => !e.batchId)
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()),
    [allKarigarExpenses]
  );

  const grandTotal = allKarigarExpenses.reduce((s, e) => s + e.amount, 0);
  const openBatchTotal = openBatchExpenses.reduce((s, e) => s + e.amount, 0);

  const handleDeleteKarigar = () => {
    if (!karigar) return;
    deleteKarigarAction(karigar.id);
    toast({ title: "Karigar Deleted" });
    router.push('/karigars');
  };

  const handleStartNewBatch = async () => {
    if (!newBatchLabel.trim()) return;
    const result = await createKarigarBatch({ karigarId, label: newBatchLabel.trim(), startDate: new Date().toISOString() });
    if (result) {
      toast({ title: "New Hisaab Started", description: `"${newBatchLabel.trim()}" is now active.` });
      setIsNewBatchOpen(false);
      setNewBatchLabel('');
    }
  };

  const handleCloseBatch = async () => {
    if (!openBatch) return;
    try {
      await closeKarigarBatch(openBatch.id, new Date().toISOString(), openBatchTotal);
      if (carryOverLabel.trim()) {
        await createKarigarBatch({ karigarId, label: carryOverLabel.trim(), startDate: new Date().toISOString() });
        toast({ title: "Settled & New Hisaab Started", description: `"${openBatch.label}" closed. "${carryOverLabel.trim()}" is now active.` });
      } else {
        toast({ title: "Hisaab Settled", description: `"${openBatch.label}" closed — PKR ${openBatchTotal.toLocaleString()}.` });
      }
      setCarryOverLabel('');
      setIsCloseDialogOpen(false);
    } catch {
      toast({ title: "Error", description: "Failed to settle hisaab.", variant: "destructive" });
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    try {
      await deleteKarigarBatch(batchId);
      toast({ title: "Batch Deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete batch.", variant: "destructive" });
    }
  };

  if (!isHydrated) return <div className="container mx-auto p-4"><p>Loading...</p></div>;

  if (!karigar) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Karigar not found</h2>
        <Link href="/karigars" passHref><Button variant="link" className="mt-4">Back to Karigars</Button></Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-3xl space-y-5">
      <Button variant="outline" size="sm" onClick={() => router.push('/karigars')}>
        <ArrowLeft className="mr-2 h-4 w-4" />Back
      </Button>

      {/* ── Profile Card ── */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <User className="h-7 w-7 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{karigar.name}</h1>
                {karigar.contact && <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5"><Phone className="h-3.5 w-3.5" />{karigar.contact}</p>}
                {karigar.notes && <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5"><StickyNote className="h-3.5 w-3.5" />{karigar.notes}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/karigars/${karigarId}/edit`}><Edit3 className="mr-1.5 h-4 w-4" />Edit</Link>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm"><Trash2 className="mr-1.5 h-4 w-4" />Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {karigar.name}?</AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteKarigar}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
          <Separator className="my-4" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Paid (all time)</p>
              <p className="text-2xl font-bold text-destructive">PKR {grandTotal.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Active Hisaab</p>
              <p className="font-semibold">{openBatch ? openBatch.label : <span className="text-muted-foreground text-sm font-normal">None</span>}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Dialogs ── */}
      <Dialog open={isPaymentFormOpen} onOpenChange={setIsPaymentFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center"><Banknote className="mr-2 h-5 w-5" />Record Payment to {karigar.name}</DialogTitle>
            {openBatch && <DialogDescription>Added to <strong>{openBatch.label}</strong></DialogDescription>}
          </DialogHeader>
          <ExpenseForm lockedKarigarId={karigarId} lockedBatchId={openBatch?.id} onSubmitSuccess={() => setIsPaymentFormOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={isNewBatchOpen} onOpenChange={setIsNewBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start New Hisaab</DialogTitle>
            <DialogDescription>Give it a name, e.g. "March 2026" or "Gold Set Batch".</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="batchLabel">Hisaab Name</Label>
            <Input id="batchLabel" placeholder="e.g. March 2026" value={newBatchLabel}
              onChange={e => setNewBatchLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleStartNewBatch()} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsNewBatchOpen(false)}>Cancel</Button>
            <Button onClick={handleStartNewBatch} disabled={!newBatchLabel.trim()}>Start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCloseDialogOpen} onOpenChange={(v) => { setIsCloseDialogOpen(v); if (!v) setCarryOverLabel(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-600" />Settle & Close Hisaab</DialogTitle>
            <DialogDescription>
              Closing <strong>{openBatch?.label}</strong> · total <strong>PKR {openBatchTotal.toLocaleString()}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="carryOverLabel">Carry over to new hisaab? <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              id="carryOverLabel"
              placeholder="New hisaab name, e.g. April 2026"
              value={carryOverLabel}
              onChange={e => setCarryOverLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCloseBatch()}
            />
            <p className="text-xs text-muted-foreground">Leave blank to just settle without starting a new hisaab.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCloseDialogOpen(false); setCarryOverLabel(''); }}>Cancel</Button>
            <Button onClick={handleCloseBatch} className="bg-green-600 hover:bg-green-700">
              <Lock className="mr-2 h-4 w-4" />{carryOverLabel.trim() ? 'Settle & Carry Over' : 'Settle & Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Active Hisaab ── */}
      {openBatch ? (
        <Card className="border-primary/30 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <Unlock className="h-4 w-4 text-primary" />
                <CardTitle className="text-lg">{openBatch.label}</CardTitle>
                <Badge>Active</Badge>
              </div>
              <CardDescription className="mt-0.5">
                Started {format(parseISO(openBatch.startDate), 'dd MMM yyyy')} · {openBatchExpenses.length} payment{openBatchExpenses.length !== 1 ? 's' : ''}
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
              <Button size="sm" onClick={() => setIsPaymentFormOpen(true)}>
                <PlusCircle className="mr-1.5 h-4 w-4" />Add Payment
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsCloseDialogOpen(true)}
                className="border-green-500 text-green-700 hover:bg-green-50 dark:hover:bg-green-950">
                <CheckCircle2 className="mr-1.5 h-4 w-4" />Settle
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex justify-between items-center p-3 rounded-lg bg-primary/5 mb-3">
              <span className="text-sm font-semibold">Hisaab Total</span>
              <span className="text-lg font-bold text-destructive">PKR {openBatchTotal.toLocaleString()}</span>
            </div>
            <ScrollArea className="max-h-72">
              {openBatchExpenses.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead><TableHead>Description</TableHead>
                      <TableHead>Category</TableHead><TableHead className="text-right">PKR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openBatchExpenses.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm whitespace-nowrap">{format(parseISO(e.date), 'dd MMM yy')}</TableCell>
                        <TableCell className="text-sm">{e.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.category}</TableCell>
                        <TableCell className="text-right font-medium text-sm">{e.amount.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-center text-muted-foreground py-8 text-sm">No payments yet. Click "Add Payment" to record one.</p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-10 gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <Banknote className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-semibold">No Active Hisaab</p>
              <p className="text-sm text-muted-foreground">Start a new hisaab to track payments in batches.</p>
            </div>
            <Button onClick={() => setIsNewBatchOpen(true)}><PlusCircle className="mr-2 h-4 w-4" />Start New Hisaab</Button>
          </CardContent>
        </Card>
      )}

      {/* Start new batch (only shows when no open batch and closed batches exist) */}
      {!openBatch && closedBatches.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setIsNewBatchOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" />Start New Hisaab
          </Button>
        </div>
      )}

      {/* Settled Hisaabs */}
      {closedBatches.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Settled Hisaabs</h3>
          {closedBatches.map(batch => {
            const batchExpenses = allKarigarExpenses
              .filter(e => e.batchId === batch.id)
              .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
            return <ClosedBatchCard key={batch.id} batch={batch} expenses={batchExpenses} onDelete={handleDeleteBatch} />;
          })}
        </div>
      )}

      {/* Pre-Hisaab (unbatched) — shown as one collapsed hisaab */}
      {unbatchedExpenses.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Pre-Hisaab</h3>
          <PreHisaabCard expenses={unbatchedExpenses} />
        </div>
      )}
    </div>
  );
}
