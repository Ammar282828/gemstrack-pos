"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  orderBy, query, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppStore } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Trash2, TrendingUp, Wallet, Plus, ArrowUpRight, ArrowDownRight, HandCoins, ChevronDown, ChevronRight, Receipt, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { calculateDistribution, partnerBalance, categorise, type LedgerCategory, type LedgerEntry } from '@/lib/partnership';
import { WorkingCapitalFloor } from '@/components/partnership/working-capital-floor';
import { DEFAULT_WORKING_CAPITAL_FLOOR } from '@/lib/partnership-settings';

// ─── Constants ───────────────────────────────────────────────────────────────
// Aligned with Mina's account — the partnership formally began on these dates
// (Jul 2, 2025 for expenses, Jul 16, 2025 for revenue with Shopify #1103).
// Pre-partnership activity is excluded from both partners' accounts.
const EXPENSE_CUTOFF = '2025-07-02';
const REVENUE_CUTOFF = '2025-07-16';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  'PKR ' + Math.abs(n).toLocaleString('en-PK', { maximumFractionDigits: 0 });

function toDate(v: any): Date {
  if (!v) return new Date();
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v);
}

interface LedgerEntryRow {
  id: string;
  description: string;
  amount: number;
  date: Date;
  category: LedgerCategory;
}

// ─── Collapsible Section ─────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  icon,
  count,
  total,
  totalLabel,
  colorClass,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  total: number;
  totalLabel: string;
  colorClass: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button onClick={() => setOpen(!open)} className="w-full text-left">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              {icon} {title}
              <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{count}</span>
            </CardTitle>
            <div className="flex items-center gap-3">
              <span className={cn('text-sm font-semibold tabular-nums', colorClass)}>{fmt(total)}</span>
              {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            </div>
          </div>
          <CardDescription className="text-xs">{totalLabel}</CardDescription>
        </CardHeader>
      </button>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function AmmarAccountPage() {
  const { toast } = useToast();
  const appReady = useAppReady();

  const {
    expenses, generatedInvoices, orders, additionalRevenues,
    isExpensesLoading, isInvoicesLoading, isOrdersLoading, isAdditionalRevenueLoading,
    loadExpenses, loadGeneratedInvoices, loadOrders, loadAdditionalRevenues,
  } = useAppStore();

  useEffect(() => {
    if (appReady) {
      loadExpenses();
      loadGeneratedInvoices();
      loadOrders();
      loadAdditionalRevenues();
    }
  }, [appReady, loadExpenses, loadGeneratedInvoices, loadOrders, loadAdditionalRevenues]);

  // ── Ledger (ammar_ledger) ───────────────────────────────────────────────────

  const [payments, setPayments] = useState<LedgerEntryRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<LedgerEntryRow[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  const loadLedger = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'ammar_ledger'), orderBy('date', 'desc')));
      const paymentRows: LedgerEntryRow[] = [];
      const withdrawalRows: LedgerEntryRow[] = [];
      for (const d of snap.docs) {
        const data = d.data();
        const row: LedgerEntryRow = {
          id: d.id,
          description: data.description,
          amount: data.amount,
          date: toDate(data.date),
          category: (data.category === 'loan' ? 'loan' : 'equity'),
        };
        if (data.type === 'payment') paymentRows.push(row);
        else if (data.type === 'withdrawal') withdrawalRows.push(row);
      }
      setPayments(paymentRows);
      setWithdrawals(withdrawalRows);
    } catch {
      toast({ title: 'Failed to load ledger', variant: 'destructive' });
    } finally {
      setPaymentsLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadLedger(); }, [loadLedger]);

  // ── Payment form (money Ammar pays into the business) ─────────────────────

  const [payDesc, setPayDesc] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [payCategory, setPayCategory] = useState<LedgerCategory>('equity');
  const [paySaving, setPaySaving] = useState(false);

  const handleAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(payAmount);
    if (!payDesc.trim() || isNaN(amt) || amt <= 0) {
      toast({ title: 'Fill in all fields', variant: 'destructive' });
      return;
    }
    setPaySaving(true);
    try {
      await addDoc(collection(db, 'ammar_ledger'), {
        type: 'payment',
        category: payCategory,
        description: payDesc.trim(),
        amount: amt,
        date: Timestamp.fromDate(new Date(payDate)),
        createdAt: serverTimestamp(),
      });
      toast({ title: 'Payment added' });
      setPayDesc('');
      setPayAmount('');
      setPayDate(new Date().toISOString().split('T')[0]);
      setPayCategory('equity');
      loadLedger();
    } catch {
      toast({ title: 'Failed to save', variant: 'destructive' });
    } finally {
      setPaySaving(false);
    }
  };

  const handleDeletePayment = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'ammar_ledger', id));
      toast({ title: 'Payment deleted' });
      setPayments(prev => prev.filter(p => p.id !== id));
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  // ── Withdrawal form (money Ammar takes from the business) ─────────────────

  const [wdDesc, setWdDesc] = useState('');
  const [wdAmount, setWdAmount] = useState('');
  const [wdDate, setWdDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [wdCategory, setWdCategory] = useState<LedgerCategory>('equity');
  const [wdSaving, setWdSaving] = useState(false);

  const handleAddWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(wdAmount);
    if (!wdDesc.trim() || isNaN(amt) || amt <= 0) {
      toast({ title: 'Fill in all fields', variant: 'destructive' });
      return;
    }
    setWdSaving(true);
    try {
      await addDoc(collection(db, 'ammar_ledger'), {
        type: 'withdrawal',
        category: wdCategory,
        description: wdDesc.trim(),
        amount: amt,
        date: Timestamp.fromDate(new Date(wdDate)),
        createdAt: serverTimestamp(),
      });
      toast({ title: 'Withdrawal added' });
      setWdDesc('');
      setWdAmount('');
      setWdDate(new Date().toISOString().split('T')[0]);
      setWdCategory('equity');
      loadLedger();
    } catch {
      toast({ title: 'Failed to save', variant: 'destructive' });
    } finally {
      setWdSaving(false);
    }
  };

  // ── Distribution calculator state ──────────────────────────────────────────
  const [calcCash, setCalcCash] = useState('');
  const [calcFloor, setCalcFloor] = useState<number>(DEFAULT_WORKING_CAPITAL_FLOOR);

  // ── Cross-partner ledger (Mina) ────────────────────────────────────────────
  const [minaBuckets, setMinaBuckets] = useState({ equityIn: 0, loanIn: 0, equityOut: 0, loanOut: 0 });
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'mina_ledger'), orderBy('date', 'desc')));
        let equityIn = 0, loanIn = 0, equityOut = 0, loanOut = 0;
        for (const d of snap.docs) {
          const data = d.data();
          const amt = Number(data.amount) || 0;
          const cat: LedgerCategory = data.category === 'loan' ? 'loan' : 'equity';
          if (data.type === 'payment') {
            if (cat === 'loan') loanIn += amt; else equityIn += amt;
          } else if (data.type === 'withdrawal') {
            if (cat === 'loan') loanOut += amt; else equityOut += amt;
          }
        }
        setMinaBuckets({ equityIn, loanIn, equityOut, loanOut });
      } catch { /* silent */ }
    })();
  }, [payments, withdrawals]);

  const handleDeleteWithdrawal = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'ammar_ledger', id));
      toast({ title: 'Withdrawal deleted' });
      setWithdrawals(prev => prev.filter(p => p.id !== id));
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' });
    }
  };

  // ── Derived data (same shape & cutoffs as Mina's page) ────────────────────

  const filteredExpenses = useMemo(() =>
    expenses
      .filter(e => e.date >= EXPENSE_CUTOFF)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [expenses]
  );

  const filteredInvoices = useMemo(() =>
    generatedInvoices
      .filter(inv => {
        if (!inv.createdAt || inv.status === 'Refunded') return false;
        return inv.createdAt >= REVENUE_CUTOFF;
      })
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')),
    [generatedInvoices]
  );

  const filteredOrders = useMemo(() => {
    const invoicedOrderIds = new Set<string>();
    orders.forEach(o => { if (o.invoiceId) invoicedOrderIds.add(o.id); });
    generatedInvoices.forEach((inv: any) => { if (inv.sourceOrderId) invoicedOrderIds.add(inv.sourceOrderId); });
    return orders
      .filter(o => {
        if (!o.createdAt || o.status === 'Cancelled' || o.status === 'Refunded') return false;
        if (invoicedOrderIds.has(o.id)) return false;
        return o.createdAt >= REVENUE_CUTOFF;
      })
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }, [orders, generatedInvoices]);

  const filteredAdditionalRevenue = useMemo(() =>
    additionalRevenues
      .filter(r => r.date >= REVENUE_CUTOFF)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [additionalRevenues]
  );

  const totalExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const ammarExpShare = totalExpenses * 0.5;
  const invoiceRevenue = filteredInvoices.reduce((s, inv) => s + (inv.grandTotal || 0), 0);
  const orderRevenue = filteredOrders.reduce((s, o) => s + (o.subtotal || 0), 0);
  const additionalRev = filteredAdditionalRevenue.reduce((s, r) => s + r.amount, 0);
  const totalRevenue = invoiceRevenue + orderRevenue + additionalRev;
  const ammarRevShare = totalRevenue * 0.5;
  const totalPayments = payments.reduce((s, p) => s + p.amount, 0);
  const totalWithdrawals = withdrawals.reduce((s, w) => s + w.amount, 0);

  // Bucketed view — equity vs loan
  const buckets = categorise(
    payments as unknown as LedgerEntry[],
    withdrawals as unknown as LedgerEntry[],
  );
  const balances = partnerBalance(buckets, ammarExpShare, ammarRevShare);
  const minaBalances = partnerBalance(minaBuckets, ammarExpShare, ammarRevShare);

  const distribution = calculateDistribution(
    Math.max(0, Number(calcCash) || 0),
    Math.max(0, calcFloor || 0),
    [
      { name: 'Ammar', loanBalance: balances.loanBalance,     equityBalance: balances.equityBalance,     netPnL: balances.netPnL },
      { name: 'Mina',  loanBalance: minaBalances.loanBalance, equityBalance: minaBalances.equityBalance, netPnL: minaBalances.netPnL },
    ],
  );

  // Legacy single-balance for the historic top card.
  // Positive balance = Ammar owes the business; Negative = business owes Ammar.
  const balance = ammarExpShare - ammarRevShare - totalPayments + totalWithdrawals;

  const isLoading = isExpensesLoading || isInvoicesLoading || isOrdersLoading || isAdditionalRevenueLoading || paymentsLoading;

  return (
    <div className="container mx-auto py-6 px-4 max-w-3xl space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <HandCoins className="w-6 h-6" /> Ammar&apos;s Account
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Expenses from Jul 2, 2025 &middot; Revenue (50%) from Shopify #1103
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <Card className={cn(
            'border-2',
            balance > 0 ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/20' :
            balance < 0 ? 'border-green-500 bg-green-50 dark:bg-green-950/20' :
                          'border-border'
          )}>
            <CardContent className="pt-6 pb-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Net Balance</p>
                  <p className={cn(
                    'text-4xl font-bold tabular-nums',
                    balance > 0 ? 'text-orange-600 dark:text-orange-400' :
                    balance < 0 ? 'text-green-600 dark:text-green-400' :
                                  'text-foreground'
                  )}>
                    {fmt(balance)}
                  </p>
                  <p className={cn(
                    'text-sm font-medium mt-1',
                    balance > 0 ? 'text-orange-600 dark:text-orange-400' :
                    balance < 0 ? 'text-green-600 dark:text-green-400' :
                                  'text-muted-foreground'
                  )}>
                    {balance > 0 ? 'Ammar owes the business' :
                     balance < 0 ? 'Business owes Ammar' :
                                   'All settled'}
                  </p>
                </div>

                <Separator className="sm:hidden" />

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center sm:text-right">
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">50% Expenses</p>
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400 tabular-nums">{fmt(ammarExpShare)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">50% Revenue</p>
                    <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 tabular-nums">{fmt(ammarRevShare)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Net Profit</p>
                    <p className="text-sm font-semibold text-muted-foreground tabular-nums">{fmt(ammarRevShare - ammarExpShare)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Paid In</p>
                    <p className="text-sm font-semibold text-green-600 dark:text-green-400 tabular-nums">{fmt(totalPayments)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Withdrawn</p>
                    <p className="text-sm font-semibold text-orange-600 dark:text-orange-400 tabular-nums">{fmt(totalWithdrawals)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground -mt-2 px-1">
            Balance = 50% Expenses &minus; 50% Revenue &minus; Payments + Withdrawals
          </p>

          {/* ── Three-bucket breakdown (loan vs equity vs P&L) ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Three-bucket view</CardTitle>
              <CardDescription>Your claim against the business, split into its components.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center sm:text-left">
                <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30">
                  <p className="text-[11px] text-blue-700 dark:text-blue-300 uppercase tracking-wide font-semibold">Loan account</p>
                  <p className="text-lg font-bold tabular-nums text-blue-700 dark:text-blue-300">{fmt(balances.loanBalance)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Paid first from business cash</p>
                </div>
                <div className="p-3 rounded-md bg-green-50 dark:bg-green-950/30">
                  <p className="text-[11px] text-green-700 dark:text-green-300 uppercase tracking-wide font-semibold">Equity (capital)</p>
                  <p className="text-lg font-bold tabular-nums text-green-700 dark:text-green-300">{fmt(balances.equityBalance)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Your stake in the partnership</p>
                </div>
                <div className="p-3 rounded-md bg-muted/40">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">P&amp;L share</p>
                  <p className={cn('text-lg font-bold tabular-nums', balances.netPnL >= 0 ? 'text-green-600' : 'text-red-600')}>{fmt(balances.netPnL)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{balances.netPnL >= 0 ? 'Your share of profit' : 'Your share of loss'}</p>
                </div>
              </div>
              <Separator className="my-3" />
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Total business owes Ammar:</span>
                <span className={cn('text-lg font-bold tabular-nums', balances.totalClaim > 0 ? 'text-green-600' : balances.totalClaim < 0 ? 'text-orange-600' : 'text-foreground')}>{fmt(balances.totalClaim)}</span>
              </div>
            </CardContent>
          </Card>

          {/* ── Distribution Calculator ── */}
          <Card className="border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Distribution calculator</CardTitle>
              <CardDescription>If the business had cash to distribute, here&apos;s how it would flow (loans repaid first, then split 50/50).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                <div className="space-y-1.5">
                  <Label className="text-sm">Business cash available (PKR)</Label>
                  <Input type="number" placeholder="e.g. 2,000,000" value={calcCash} onChange={e => setCalcCash(e.target.value)} min={0} />
                </div>
                <WorkingCapitalFloor onFloorChange={setCalcFloor} setBy="Ammar" />
              </div>

              <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Cash on hand</span><span className="tabular-nums">{fmt(distribution.cashOnHand)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">− Working capital floor</span><span className="tabular-nums">{fmt(distribution.workingCapitalFloor)}</span></div>
                <Separator />
                <div className="flex justify-between font-medium"><span>Distributable</span><span className="tabular-nums">{fmt(distribution.distributableCash)}</span></div>
              </div>

              {distribution.feasible ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Step 1 — Repay loans</p>
                    {distribution.perPartner.filter(p => p.loanRepayment > 0).length === 0 ? (
                      <p className="text-sm text-muted-foreground italic px-2">No outstanding loans</p>
                    ) : (
                      <div className="space-y-1">
                        {distribution.perPartner.filter(p => p.loanRepayment > 0).map(p => (
                          <div key={p.name} className="flex justify-between text-sm px-2">
                            <span>{p.name}</span>
                            <span className="tabular-nums font-medium text-blue-700 dark:text-blue-300">{fmt(p.loanRepayment)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-1">Step 2 — Split remaining 50 / 50</p>
                    {distribution.profitPoolTotal === 0 ? (
                      <p className="text-sm text-muted-foreground italic px-2">Nothing left after loan repayments</p>
                    ) : (
                      <div className="space-y-1">
                        {distribution.perPartner.map(p => (
                          <div key={p.name} className="flex justify-between text-sm px-2">
                            <span>{p.name}</span>
                            <span className="tabular-nums font-medium text-green-700 dark:text-green-300">{fmt(p.profitShare)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Total per partner</p>
                    {distribution.perPartner.map(p => (
                      <div key={p.name} className="flex justify-between text-base font-bold px-2">
                        <span>{p.name}</span>
                        <span className="tabular-nums">{fmt(p.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {distribution.cashOnHand === 0
                    ? 'Enter the current business cash to see how it would distribute.'
                    : `Cash on hand (${fmt(distribution.cashOnHand)}) is below the working-capital floor — nothing to distribute right now.`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Expenses (auto, read-only) ── */}
          <CollapsibleSection
            title="Expenses (50%)"
            icon={<CreditCard className="w-4 h-4 text-red-500" />}
            count={filteredExpenses.length}
            total={ammarExpShare}
            totalLabel={`50% of ${fmt(totalExpenses)} total expenses from Jul 2, 2025`}
            colorClass="text-red-600 dark:text-red-400"
          >
            <div className="max-h-80 overflow-y-auto">
              {filteredExpenses.map(e => (
                <div key={e.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                    <ArrowUpRight className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{e.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(e.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {e.category ? ` · ${e.category}` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-red-600 dark:text-red-400 flex-shrink-0">
                    {fmt(e.amount * 0.5)}
                  </p>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* ── Revenue (auto, read-only) ── */}
          <CollapsibleSection
            title="Revenue (50%)"
            icon={<Receipt className="w-4 h-4 text-blue-500" />}
            count={filteredInvoices.length + filteredOrders.length + filteredAdditionalRevenue.length}
            total={ammarRevShare}
            totalLabel={`50% of ${fmt(totalRevenue)} total revenue (invoices + orders + extra)`}
            colorClass="text-blue-600 dark:text-blue-400"
          >
            <div className="max-h-80 overflow-y-auto">
              {filteredAdditionalRevenue.map(r => (
                <div key={`ar-${r.id}`} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                    <TrendingUp className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{r.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · Extra Revenue · Total: '}{fmt(r.amount)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-purple-600 dark:text-purple-400 flex-shrink-0">
                    {fmt(r.amount * 0.5)}
                  </p>
                </div>
              ))}
              {filteredInvoices.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                    <TrendingUp className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">
                      {inv.id}{inv.customerName ? ` · ${inv.customerName}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      {' · Total: '}{fmt(inv.grandTotal || 0)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-blue-600 dark:text-blue-400 flex-shrink-0">
                    {fmt((inv.grandTotal || 0) * 0.5)}
                  </p>
                </div>
              ))}
              {filteredOrders.map(o => (
                <div key={o.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                    <TrendingUp className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">
                      {o.id}{o.customerName ? ` · ${o.customerName}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      {' · Order · Total: '}{fmt(o.subtotal || 0)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-teal-600 dark:text-teal-400 flex-shrink-0">
                    {fmt((o.subtotal || 0) * 0.5)}
                  </p>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* ── Payments (manual: money Ammar puts INTO the business) ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="w-4 h-4 text-green-500" /> Payments by Ammar
                {payments.length > 0 && (
                  <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{payments.length}</span>
                )}
              </CardTitle>
              <CardDescription>Direct cash or transfer payments Ammar has made to the business (covering expenses, contributing capital).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleAddPayment} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 sm:col-span-3">
                    <Label className="text-sm">Description</Label>
                    <Input
                      placeholder="e.g. Cash payment, Bank transfer"
                      value={payDesc}
                      onChange={e => setPayDesc(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Amount (PKR)</Label>
                    <Input
                      type="number"
                      placeholder="Amount"
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      min={0}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Date</Label>
                    <Input
                      type="date"
                      value={payDate}
                      onChange={e => setPayDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Type</Label>
                    <Select value={payCategory} onValueChange={(v) => setPayCategory(v as LedgerCategory)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equity">Equity (capital contribution)</SelectItem>
                        <SelectItem value="loan">Loan (to be repaid first)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2 flex items-end">
                    <Button type="submit" size="sm" disabled={paySaving} className="w-full">
                      {paySaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Add Payment
                    </Button>
                  </div>
                </div>
              </form>

              {payments.length > 0 && <Separator />}

              {payments.map(p => (
                <div key={p.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <ArrowDownRight className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{p.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-green-600 dark:text-green-400 flex-shrink-0">
                    {fmt(p.amount)}
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete payment?</AlertDialogTitle>
                        <AlertDialogDescription>
                          &ldquo;{p.description}&rdquo; &mdash; {fmt(p.amount)}. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeletePayment(p.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}

              {payments.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No payments recorded yet.</p>
              )}
            </CardContent>
          </Card>

          {/* ── Withdrawals (manual: money Ammar takes OUT of the business) ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-orange-500" /> Withdrawals by Ammar
                {withdrawals.length > 0 && (
                  <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{withdrawals.length}</span>
                )}
              </CardTitle>
              <CardDescription>Money Ammar has taken from the business (cash, transfer, personal use, etc.).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleAddWithdrawal} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 sm:col-span-3">
                    <Label className="text-sm">Description</Label>
                    <Input
                      placeholder="e.g. Personal cash, Bank transfer out"
                      value={wdDesc}
                      onChange={e => setWdDesc(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Amount (PKR)</Label>
                    <Input
                      type="number"
                      placeholder="Amount"
                      value={wdAmount}
                      onChange={e => setWdAmount(e.target.value)}
                      min={0}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Date</Label>
                    <Input
                      type="date"
                      value={wdDate}
                      onChange={e => setWdDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Type</Label>
                    <Select value={wdCategory} onValueChange={(v) => setWdCategory(v as LedgerCategory)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equity">Equity draw (against capital)</SelectItem>
                        <SelectItem value="loan">Loan repayment (received back)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="sm:col-span-2 flex items-end">
                    <Button type="submit" size="sm" disabled={wdSaving} className="w-full">
                      {wdSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Add Withdrawal
                    </Button>
                  </div>
                </div>
              </form>

              {withdrawals.length > 0 && <Separator />}

              {withdrawals.map(w => (
                <div key={w.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                    <ArrowUpRight className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{w.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {w.date.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-orange-600 dark:text-orange-400 flex-shrink-0">
                    {fmt(w.amount)}
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete withdrawal?</AlertDialogTitle>
                        <AlertDialogDescription>
                          &ldquo;{w.description}&rdquo; &mdash; {fmt(w.amount)}. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDeleteWithdrawal(w.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}

              {withdrawals.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No withdrawals recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
