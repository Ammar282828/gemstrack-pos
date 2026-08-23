"use client";

/**
 * Shareholder Finances — Mina and Ammar in one place.
 *
 * They had a page each, ~830 lines apiece, differing by a name and a
 * collection; both already loaded both ledgers for the distribution waterfall.
 * Side by side you can actually see who is in for how much, which was the
 * whole point and the one thing two separate pages could never show.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore, getInvoiceRevenueDate } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Trash2, Users, ArrowDownLeft, ArrowUpRight, Plus, Wallet, Info, BadgeIndianRupee,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SearchablePicker } from '@/components/shared/searchable-picker';
import { BoardSkeleton } from '@/components/shared/skeletons';
import {
  calculateDistribution, partnerBalance, categorise, PARTNER_SALARY,
  type LedgerCategory, type LedgerEntry,
} from '@/lib/partnership';
import { WorkingCapitalFloor } from '@/components/partnership/working-capital-floor';
import { DEFAULT_WORKING_CAPITAL_FLOOR } from '@/lib/partnership-settings';
import {
  SHAREHOLDERS, PARTNER_DRAWINGS, loadLedger, addLedgerEntry, deleteLedgerEntry,
  linkExpense, isBusinessCost, type ShareholderId, type LedgerRow,
} from '@/lib/shareholders';
import { format } from 'date-fns';
import { AmountInput } from '@/components/ui/amount-input';

/** Expenses from "Pearls - Studs x2" onward. */
const EXPENSE_CUTOFF = '2025-07-02';
/** Revenue from Shopify order #1103 onward. */
const REVENUE_CUTOFF = '2025-07-16';

const fmt = (n: number) => 'PKR ' + Math.abs(Math.round(n)).toLocaleString('en-PK');
const today = () => new Date().toISOString().split('T')[0];

type Mode = 'contribution' | 'salary' | 'withdrawal';

/**
 * A salary is not a draw.
 *
 * A draw hands a partner their own capital back — it shrinks their stake and
 * is not a business cost. A salary pays them for work, which is a cost like
 * any other wage, so it stays inside profit and does not touch their equity.
 * The consequence worth knowing: on a 50/50 split, half of one partner's
 * salary comes out of the other partner's share, so unequal salaries move
 * money between the partners. Equal ones cancel.
 */

export default function ShareholderFinancesPage() {
  const { toast } = useToast();
  const appReady = useAppReady();

  const {
    expenses, generatedInvoices, orders, additionalRevenues, addExpense, deleteExpense,
    isExpensesLoading, isInvoicesLoading, isOrdersLoading, isAdditionalRevenueLoading,
    loadExpenses, loadGeneratedInvoices, loadOrders, loadAdditionalRevenues,
  } = useAppStore();

  useEffect(() => {
    if (appReady) {
      loadExpenses(); loadGeneratedInvoices(); loadOrders(); loadAdditionalRevenues();
    }
  }, [appReady, loadExpenses, loadGeneratedInvoices, loadOrders, loadAdditionalRevenues]);

  const [ledgers, setLedgers] = useState<Record<ShareholderId, LedgerRow[]>>({ mina: [], ammar: [] });
  const [ledgersLoading, setLedgersLoading] = useState(true);

  const refreshLedgers = useCallback(async () => {
    setLedgersLoading(true);
    try {
      const [mina, ammar] = await Promise.all([loadLedger('mina'), loadLedger('ammar')]);
      setLedgers({ mina, ammar });
    } catch {
      toast({ title: 'Could not load the ledgers', variant: 'destructive' });
    } finally {
      setLedgersLoading(false);
    }
  }, [toast]);

  useEffect(() => { refreshLedgers(); }, [refreshLedgers]);

  // ── Business P&L since the partnership started ────────────────────────────

  const ordersById = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders]);

  const totals = useMemo(() => {
    // Drawings are excluded here on purpose: a partner taking money out is a
    // reduction of their own equity, not a shared cost. Counting it here would
    // charge them for it twice.
    const businessExpenses = expenses.filter(e => e.date >= EXPENSE_CUTOFF && isBusinessCost(e));
    const totalExpenses = businessExpenses.reduce((s, e) => s + e.amount, 0);

    const invoiceRevenue = generatedInvoices
      .filter(inv => inv.createdAt && inv.status !== 'Refunded'
        && getInvoiceRevenueDate(inv, ordersById) >= REVENUE_CUTOFF)
      .reduce((s, inv) => s + (inv.grandTotal || 0), 0);

    const invoicedOrderIds = new Set<string>();
    orders.forEach(o => { if (o.invoiceId) invoicedOrderIds.add(o.id); });
    generatedInvoices.forEach((inv: any) => { if (inv.sourceOrderId) invoicedOrderIds.add(inv.sourceOrderId); });
    const orderRevenue = orders
      .filter(o => o.createdAt && o.status !== 'Cancelled' && o.status !== 'Refunded'
        && !invoicedOrderIds.has(o.id) && o.createdAt >= REVENUE_CUTOFF)
      .reduce((s, o) => s + (o.subtotal || 0), 0);

    const additionalRev = additionalRevenues
      .filter(r => r.date >= REVENUE_CUTOFF)
      .reduce((s, r) => s + r.amount, 0);

    const totalRevenue = invoiceRevenue + orderRevenue + additionalRev;
    const drawings = expenses
      .filter(e => e.date >= EXPENSE_CUTOFF && e.category === PARTNER_DRAWINGS)
      .reduce((s, e) => s + e.amount, 0);

    return { totalExpenses, totalRevenue, drawings, expShare: totalExpenses / 2, revShare: totalRevenue / 2 };
  }, [expenses, generatedInvoices, orders, additionalRevenues, ordersById]);

  /** Salary rows live in Expenses, not the ledger — a wage is a cost of doing
   *  business, not a movement of anybody's capital. */
  const salariesBy = useMemo(() => {
    const out: Record<string, typeof expenses> = { mina: [], ammar: [] };
    for (const e of expenses) {
      if (e.category !== PARTNER_SALARY || !e.shareholderId) continue;
      (out[e.shareholderId] ||= []).push(e);
    }
    for (const k of Object.keys(out)) {
      out[k].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }
    return out;
  }, [expenses]);

  /** One partner's position, from their ledger plus their half of the P&L. */
  const positions = useMemo(() => {
    return SHAREHOLDERS.map(s => {
      const rows = ledgers[s.id] || [];
      const payments = rows.filter(r => r.type === 'payment');
      const withdrawals = rows.filter(r => r.type === 'withdrawal');
      const buckets = categorise(payments as unknown as LedgerEntry[], withdrawals as unknown as LedgerEntry[]);
      const salaries = salariesBy[s.id] || [];
      return {
        ...s,
        rows, payments, withdrawals, salaries,
        contributed: payments.reduce((a, p) => a + p.amount, 0),
        withdrawn: withdrawals.reduce((a, w) => a + w.amount, 0),
        salaryPaid: salaries.reduce((a, e) => a + e.amount, 0),
        balance: partnerBalance(buckets, totals.expShare, totals.revShare),
      };
    });
  }, [ledgers, salariesBy, totals.expShare, totals.revShare]);

  /** Unequal salaries quietly move money between partners; equal ones cancel. */
  const salaryGap = useMemo(() => {
    const [a, b] = positions;
    if (!a || !b) return null;
    const diff = a.salaryPaid - b.salaryPaid;
    if (Math.abs(diff) < 1) return null;
    const ahead = diff > 0 ? a : b;
    const behind = diff > 0 ? b : a;
    return { ahead, behind, transferred: Math.abs(diff) / 2 };
  }, [positions]);

  // ── Distribution waterfall ────────────────────────────────────────────────

  const [calcCash, setCalcCash] = useState('');
  const [calcFloor, setCalcFloor] = useState<number>(DEFAULT_WORKING_CAPITAL_FLOOR);

  const distribution = useMemo(() => calculateDistribution(
    Math.max(0, Number(calcCash) || 0),
    Math.max(0, calcFloor || 0),
    positions.map(p => ({
      name: p.name,
      loanBalance: p.balance.loanBalance,
      equityBalance: p.balance.equityBalance,
      netPnL: p.balance.netPnL,
    })),
  ), [calcCash, calcFloor, positions]);

  // ── Add / take money ──────────────────────────────────────────────────────

  const [mode, setMode] = useState<Mode | null>(null);
  const [who, setWho] = useState<ShareholderId>('mina');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<LedgerCategory>('equity');
  const [saving, setSaving] = useState(false);

  const openDialog = (m: Mode, id?: ShareholderId) => {
    setMode(m);
    if (id) setWho(id);
    setDesc(''); setAmount(''); setDate(today()); setCategory('equity');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!desc.trim() || isNaN(amt) || amt <= 0) {
      toast({ title: 'Add a description and an amount', variant: 'destructive' });
      return;
    }
    const person = SHAREHOLDERS.find(s => s.id === who)!;
    setSaving(true);
    try {
      if (mode === 'salary') {
        // Only an expense. A wage does not move anyone's capital, so nothing
        // is written to the ledger — writing a withdrawal here would shrink
        // their stake on top of paying them, which is the draw, not a salary.
        const expense = await addExpense({
          date: new Date(date).toISOString(),
          category: PARTNER_SALARY,
          description: `${person.name} salary — ${desc.trim()}`,
          amount: amt,
          paidBy: 'business',
          shareholderId: who,
        });
        if (!expense?.id) throw new Error('expense write failed');
        toast({ title: `${person.name} paid ${fmt(amt)}`, description: 'Recorded as a salary expense.' });
      } else if (mode === 'contribution') {
        await addLedgerEntry(who, {
          type: 'payment', category, description: desc.trim(), amount: amt, date: new Date(date),
        });
        toast({ title: `${person.name}'s contribution recorded`, description: fmt(amt) });
      } else {
        // Two writes: the ledger draw, and the expense that makes the cash
        // showing up in Expenses. paidBy is 'business' deliberately — marking
        // it as paid by the partner would make addExpense log a matching loan
        // back onto their ledger and cancel the draw out.
        const expense = await addExpense({
          date: new Date(date).toISOString(),
          category: PARTNER_DRAWINGS,
          description: `${person.name} — ${desc.trim()}`,
          amount: amt,
          paidBy: 'business',
        });
        const entryId = await addLedgerEntry(who, {
          type: 'withdrawal', category, description: desc.trim(), amount: amt, date: new Date(date),
          ...(expense?.id ? { linkedExpenseId: expense.id } : {}),
        });
        if (expense?.id) await linkExpense(who, entryId, expense.id);
        toast({
          title: `${person.name} took ${fmt(amt)}`,
          description: expense?.id ? 'Logged as a Partner Drawings expense too.' : 'Ledger updated; the expense could not be written.',
          variant: expense?.id ? undefined : 'destructive',
        });
      }
      setMode(null);
      await refreshLedgers();
      loadExpenses();
    } catch {
      toast({ title: 'Could not save that', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const removeSalary = async (expenseId: string) => {
    try {
      await deleteExpense(expenseId);
      toast({ title: 'Salary payment removed' });
      loadExpenses();
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  const removeEntry = async (id: ShareholderId, row: LedgerRow) => {
    try {
      await deleteLedgerEntry(id, row.id);
      // A draw's expense goes with it, or the money would look spent twice.
      if (row.linkedExpenseId) await deleteExpense(row.linkedExpenseId);
      toast({ title: 'Entry removed' });
      await refreshLedgers();
      loadExpenses();
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  const isLoading = isExpensesLoading || isInvoicesLoading || isOrdersLoading
    || isAdditionalRevenueLoading || ledgersLoading;

  if (!appReady || isLoading) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-6xl">
        <BoardSkeleton tiles={3} panels={2} />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-6xl space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5">
            <Users className="w-7 h-7 flex-shrink-0" />Shareholder Finances
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Divided equally · expenses from {format(new Date(EXPENSE_CUTOFF), 'd MMM yyyy')} · revenue from Shopify #1103
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">
          <Button size="sm" variant="outline" onClick={() => openDialog('contribution')}>
            <Plus className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Add contribution</span><span className="sm:hidden">Add</span>
          </Button>
          <Button size="sm" onClick={() => openDialog('salary')}>
            <BadgeIndianRupee className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Pay salary</span><span className="sm:hidden">Salary</span>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Revenue</p>
          <p className="text-base sm:text-lg md:text-xl font-bold text-success leading-tight truncate">{fmt(totals.totalRevenue)}</p>
        </div>
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Expenses</p>
          <p className="text-base sm:text-lg md:text-xl font-bold leading-tight truncate">{fmt(totals.totalExpenses)}</p>
        </div>
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Each partner&apos;s share</p>
          <p className={cn('text-base sm:text-lg md:text-xl font-bold leading-tight truncate',
            totals.revShare - totals.expShare >= 0 ? 'text-success' : 'text-destructive')}>
            {totals.revShare - totals.expShare >= 0 ? '+' : '−'}{fmt(totals.revShare - totals.expShare)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {positions.map(p => {
          const claim = p.balance.totalClaim;
          const owed = claim > 0;
          return (
            <Card key={p.id} className={cn('border-2', owed ? 'border-success/40' : claim < 0 ? 'border-warning/40' : '')}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {owed ? 'The business owes ' + p.name : claim < 0 ? p.name + ' owes the business' : 'All settled'}
                    </CardDescription>
                  </div>
                  <p className={cn('text-2xl font-bold tabular-nums flex-shrink-0',
                    owed ? 'text-success' : claim < 0 ? 'text-warning' : '')}>
                    {fmt(claim)}
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <dl className="text-sm space-y-1.5">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Loan to the business</dt>
                    <dd className="tabular-nums">{fmt(p.balance.loanBalance)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Equity in the business</dt>
                    <dd className="tabular-nums">{fmt(p.balance.equityBalance)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Half of profit &amp; loss</dt>
                    <dd className={cn('tabular-nums', p.balance.netPnL >= 0 ? 'text-success' : 'text-destructive')}>
                      {p.balance.netPnL >= 0 ? '+' : '−'}{fmt(p.balance.netPnL)}
                    </dd>
                  </div>
                </dl>

                <div className="flex gap-2 pt-1">
                  <div className="flex-1 rounded-lg bg-muted/50 p-2 min-w-0">
                    <p className="text-2xs text-muted-foreground flex items-center gap-1">
                      <ArrowDownLeft className="h-3 w-3" />Contributed
                    </p>
                    <p className="text-sm font-semibold tabular-nums truncate">{fmt(p.contributed)}</p>
                  </div>
                  <div className="flex-1 rounded-lg bg-muted/50 p-2 min-w-0">
                    <p className="text-2xs text-muted-foreground flex items-center gap-1">
                      <BadgeIndianRupee className="h-3 w-3" />Salary
                    </p>
                    <p className="text-sm font-semibold tabular-nums truncate">{fmt(p.salaryPaid)}</p>
                  </div>
                  <div className="flex-1 rounded-lg bg-muted/50 p-2 min-w-0">
                    <p className="text-2xs text-muted-foreground flex items-center gap-1">
                      <ArrowUpRight className="h-3 w-3" />Capital drawn
                    </p>
                    <p className="text-sm font-semibold tabular-nums truncate">{fmt(p.withdrawn)}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 h-8 text-xs"
                    onClick={() => openDialog('salary', p.id)}>
                    <BadgeIndianRupee className="h-3.5 w-3.5 mr-1" />Pay salary
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1 h-8 text-xs"
                    onClick={() => openDialog('contribution', p.id)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Contribution
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs px-2"
                    onClick={() => openDialog('withdrawal', p.id)}
                    title="Withdraw capital — reduces their stake; this is not a salary">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {p.rows.length + p.salaries.length > 0 ? (
                  <div className="border-t pt-2 max-h-64 overflow-y-auto -mx-1 px-1">
                    {p.salaries.map(e => (
                      <div key={e.id} className="flex items-center gap-2 py-1.5 border-b last:border-0">
                        <span className="h-1.5 w-1.5 rounded-full flex-shrink-0 bg-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{e.description.replace(`${p.name} salary — `, '')}</p>
                          <p className="text-2xs text-muted-foreground">
                            {format(new Date(e.date), 'd MMM yyyy')} · Salary · recorded as a business cost
                          </p>
                        </div>
                        <span className="text-sm tabular-nums flex-shrink-0 text-primary">{fmt(e.amount)}</span>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive flex-shrink-0"
                              aria-label={`Delete ${e.description}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this salary payment?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {e.description} — {fmt(e.amount)}. It will be deleted from Expenses too.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => removeSalary(e.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                    {p.rows.map(r => (
                      <div key={r.id} className="flex items-center gap-2 py-1.5 border-b last:border-0">
                        <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0',
                          r.type === 'payment' ? 'bg-success' : 'bg-warning')} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{r.description}</p>
                          <p className="text-2xs text-muted-foreground">
                            {format(r.date, 'd MMM yyyy')} · {r.category === 'loan' ? 'Loan' : 'Equity'}
                            {r.linkedExpenseId && ' · logged as an expense'}
                          </p>
                        </div>
                        <span className={cn('text-sm tabular-nums flex-shrink-0',
                          r.type === 'payment' ? 'text-success' : 'text-warning')}>
                          {r.type === 'payment' ? '+' : '−'}{fmt(r.amount)}
                        </span>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive flex-shrink-0"
                              aria-label={`Delete ${r.description}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove this entry?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {r.description} — {fmt(r.amount)}.
                                {r.linkedExpenseId && ' The matching Partner Drawings expense will be deleted too.'}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => removeEntry(p.id, r)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-3 border-t">No entries recorded.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {salaryGap && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 px-1">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          {salaryGap.ahead.name} has drawn {fmt(salaryGap.ahead.salaryPaid - salaryGap.behind.salaryPaid)} more
          salary than {salaryGap.behind.name}. A salary is a business cost split 50/50, so that gap has moved
          about {fmt(salaryGap.transferred)} from {salaryGap.behind.name} to {salaryGap.ahead.name}. Equal
          salaries cancel out entirely.
        </p>
      )}

      {totals.drawings > 0 && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 px-1">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          {fmt(totals.drawings)} of drawings sits in Expenses under &ldquo;{PARTNER_DRAWINGS}&rdquo;. It is left out of
          the profit split above, because a draw already reduces that partner&apos;s own equity — counting it as a
          shared cost as well would charge them for it twice.
        </p>
      )}

      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" />Distribution calculator</CardTitle>
          <CardDescription>
            If there were cash to distribute, this is how it would flow — loans repaid first, then the split.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="calcCash" className="text-xs">Cash available</Label>
              <AmountInput id="calcCash" inputMode="decimal" placeholder="0"
                value={calcCash} onValueChange={v => setCalcCash(v === undefined ? '' : String(v))} className="mt-1" />
            </div>
            <WorkingCapitalFloor onFloorChange={setCalcFloor} setBy="Shareholders" />
          </div>

          {Number(calcCash) > 0 && (
            <div className="rounded-lg border divide-y">
              <div className="flex justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Held back as working capital</span>
                <span className="tabular-nums">{fmt(distribution.workingCapitalFloor)}</span>
              </div>
              <div className="flex justify-between px-3 py-2 text-sm">
                <span className="text-muted-foreground">Available to distribute</span>
                <span className="tabular-nums">{fmt(distribution.distributableCash)}</span>
              </div>
              {distribution.perPartner.map(pr => (
                <div key={pr.name} className="px-3 py-2">
                  <div className="flex justify-between text-sm font-medium">
                    <span>{pr.name}</span>
                    <span className="tabular-nums">{fmt(pr.total)}</span>
                  </div>
                  <div className="flex gap-3 text-2xs text-muted-foreground mt-0.5">
                    <span>loan {fmt(pr.loanRepayment)}</span>
                    <span>equity {fmt(pr.equityDraw)}</span>
                    <span>profit {fmt(pr.profitShare)}</span>
                  </div>
                </div>
              ))}
              {!distribution.feasible && (
                <p className="px-3 py-2 text-2xs text-warning">
                  Not enough to clear the floor and the loans — {fmt(distribution.shortfallToFirstDistribution)} short.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={mode !== null} onOpenChange={o => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === 'salary' ? 'Pay a salary'
                : mode === 'withdrawal' ? 'Withdraw capital'
                : 'Add a contribution'}
            </DialogTitle>
            <DialogDescription>
              {mode === 'salary'
                ? 'Remuneration for work performed. Recorded in Expenses as a business cost; it does not affect their stake in the business.'
                : mode === 'withdrawal'
                ? 'Capital returned to the partner, which reduces their stake. This is not remuneration — use Pay salary for that.'
                : 'Funds contributed to the business — as equity, or as a loan repaid before profits are split.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label className="text-xs">Shareholder</Label>
              <SearchablePicker
                value={who}
                onChange={v => v && setWho(v as ShareholderId)}
                options={SHAREHOLDERS.map(s => ({ value: s.id, label: s.name }))}
                aria-label="Shareholder"
                triggerClassName="mt-1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="amt" className="text-xs">Amount (PKR)</Label>
                <AmountInput id="amt" inputMode="decimal" placeholder="0"
                  value={amount} onValueChange={v => setAmount(v === undefined ? '' : String(v))} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="dt" className="text-xs">Date</Label>
                <Input id="dt" type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1" />
              </div>
            </div>

            {mode !== 'salary' && (
            <div>
              <Label className="text-xs">Treated as</Label>
              <SearchablePicker
                value={category}
                onChange={v => v && setCategory(v as LedgerCategory)}
                options={[
                  { value: 'equity', label: 'Equity', hint: mode === 'withdrawal' ? 'Reduces their stake in the business' : 'Their stake in the business' },
                  { value: 'loan', label: 'Loan', hint: mode === 'withdrawal' ? 'Repayment of funds they lent' : 'Repaid before profits are distributed' },
                ]}
                aria-label="Equity or loan"
                triggerClassName="mt-1"
              />
            </div>
            )}

            {mode === 'salary' && salaryGap && salaryGap.behind.id === who && (
              <p className="text-2xs text-muted-foreground flex items-start gap-1.5">
                <Info className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                {salaryGap.ahead.name} is {fmt(salaryGap.ahead.salaryPaid - salaryGap.behind.salaryPaid)} ahead on
                salary. Paying {SHAREHOLDERS.find(x => x.id === who)?.name} evens that up.
              </p>
            )}

            <div>
              <Label htmlFor="ds" className="text-xs">Description</Label>
              <Input id="ds" placeholder={mode === 'salary' ? 'e.g. August' : mode === 'withdrawal' ? 'e.g. capital returned' : 'e.g. bank transfer'}
                value={desc} onChange={e => setDesc(e.target.value)} className="mt-1" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setMode(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {mode === 'salary' ? 'Pay salary' : mode === 'withdrawal' ? 'Record withdrawal' : 'Record contribution'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
