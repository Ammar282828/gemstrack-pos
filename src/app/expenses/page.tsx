"use client";

/**
 * Expenses.
 *
 * The old page was a flat list of every expense ever, newest first, with a
 * total on top — fine for twenty rows, useless for a year of them. Money is
 * read at a granularity: what went out today, this week, this month. So the
 * page has two date controls that do different jobs — the period picks how far
 * back you are looking, the grouping picks how coarsely the rows are bucketed —
 * and every bucket carries its own subtotal.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import { FilterBar } from '@/components/shared/filter-bar';
import { useAppStore, Expense, EXPENSE_CATEGORIES } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Edit, Trash2, CreditCard, FileText, User, BookOpen } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ExpenseForm } from '@/components/expense/expense-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from "react-day-picker";
import { PERIODS, GRADUATIONS, periodRange, bucketOf, type PeriodId, type Graduation } from '@/lib/date-grouping';
import { cn, openPDFWindowForIOS, savePDF } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SwipeToDelete } from '@/components/ui/swipe-to-delete';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { SHAREHOLDERS } from '@/lib/shareholders';
import { fitText } from '@/lib/pdf-text';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const PKR = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

export default function ExpensesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | undefined>(undefined);
  const [period, setPeriod] = useState<PeriodId>('this-month');
  const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
  const [graduation, setGraduation] = useState<Graduation>('day');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  const appReady = useAppReady();
  const {
    expenses, deleteExpense, isExpensesLoading, loadExpenses, settings,
    karigars, loadKarigars, karigarBatches, loadKarigarBatches,
  } = useAppStore();
  const { toast } = useToast();

  useEffect(() => {
    if (appReady) { loadExpenses(); loadKarigars(); loadKarigarBatches(); }
  }, [appReady, loadExpenses, loadKarigars, loadKarigarBatches]);

  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteExpense(id);
      toast({ title: "Expense deleted", description: "The record has been removed." });
    } catch (err) {
      console.error('Failed to delete expense:', err);
      toast({ title: "Delete failed", description: "Could not delete the expense.", variant: "destructive" });
    }
  };

  const handleEditExpense = (expense: Expense) => { setEditingExpense(expense); setIsFormOpen(true); };
  const handleAddNew = () => { setEditingExpense(undefined); setIsFormOpen(true); };
  const handleFormSuccess = () => { setIsFormOpen(false); setEditingExpense(undefined); };

  const range = useMemo(() => periodRange(period, customRange), [period, customRange]);

  const filteredExpenses = useMemo(() => {
    if (!appReady) return [];
    const needle = searchTerm.trim().toLowerCase();
    return expenses
      .filter(e => {
        if (categoryFilter !== 'All' && e.category !== categoryFilter) return false;
        if (range) {
          const d = parseISO(e.date);
          if (!isWithinInterval(d, { start: range.start, end: range.end })) return false;
        }
        if (!needle) return true;
        const k = e.karigarId ? karigars.find(x => x.id === e.karigarId)?.name || '' : '';
        return e.description.toLowerCase().includes(needle)
          || e.category.toLowerCase().includes(needle)
          || k.toLowerCase().includes(needle);
      })
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [expenses, searchTerm, appReady, range, categoryFilter, karigars]);

  /** Rows bucketed by the chosen graduation, each with its own subtotal. */
  const groups = useMemo(() => {
    const out: { key: string; label: string; sub: string; total: number; rows: Expense[] }[] = [];
    const index = new Map<string, number>();
    for (const e of filteredExpenses) {
      const b = bucketOf(parseISO(e.date), graduation);
      let i = index.get(b.key);
      if (i === undefined) {
        i = out.length;
        index.set(b.key, i);
        out.push({ ...b, total: 0, rows: [] });
      }
      out[i].total += e.amount;
      out[i].rows.push(e);
    }
    return out;
  }, [filteredExpenses, graduation]);

  const summary = useMemo(() => {
    const total = filteredExpenses.reduce((s, e) => s + e.amount, 0);
    const karigarTotal = filteredExpenses.filter(e => e.karigarId).reduce((s, e) => s + e.amount, 0);
    const buckets = groups.length || 1;
    return {
      total,
      count: filteredExpenses.length,
      karigarTotal,
      karigarShare: total > 0 ? Math.round((karigarTotal / total) * 100) : 0,
      perBucket: total / buckets,
      biggest: groups.reduce((m, g) => (g.total > m.total ? g : m), { total: 0, label: '—' } as { total: number; label: string }),
    };
  }, [filteredExpenses, groups]);

  const batchLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of karigarBatches || []) m.set(b.id, b.label);
    return m;
  }, [karigarBatches]);

  const periodLabel = PERIODS.find(p => p.id === period)?.label ?? '';

  const handlePrintReport = async () => {
    if (!settings) {
      toast({ title: "Error", description: "Settings not loaded, cannot generate report.", variant: "destructive" });
      return;
    }
    const iOSWin = openPDFWindowForIOS();
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold").setFontSize(18);
    doc.text(`Expense Report`, 14, 22);
    doc.setFont("helvetica", "normal").setFontSize(10);
    doc.text(`As of: ${format(new Date(), 'PPpp')}`, pageWidth - 14, 22, { align: 'right' });
    const filterSummary = [
      `Period: ${periodLabel}${range ? ` (${format(range.start, 'PP')} – ${format(range.end, 'PP')})` : ''}`,
      `Grouped by: ${graduation}`,
      `Category: ${categoryFilter}`,
      `Search: ${searchTerm || 'None'}`,
    ].join(' | ');
    // A long search term used to run straight off the page.
    fitText(doc, `Filters: ${filterSummary}`, 14, 29, doc.internal.pageSize.getWidth() - 28);

    // The PDF follows the same graduation as the screen, subtotals included,
    // so a printed report matches what was on screen when it was asked for.
    const body: any[] = [];
    for (const g of groups) {
      body.push([{ content: `${g.label}${g.sub ? ` · ${g.sub}` : ''}`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
                 { content: g.total.toLocaleString(undefined, { minimumFractionDigits: 2 }), styles: { fontStyle: 'bold', halign: 'right', fillColor: [240, 240, 240] } }]);
      for (const e of g.rows) {
        body.push([
          format(parseISO(e.date), 'dd-MMM-yyyy'),
          e.category,
          e.description,
          e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }),
        ]);
      }
    }

    doc.autoTable({
      head: [["Date", "Category", "Description", "Amount (PKR)"]],
      body,
      startY: 40,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185], textColor: 255 },
      columnStyles: { 3: { halign: 'right' } },
    });

    const finalY = (doc as any).lastAutoTable.finalY;
    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.text(
      `Total Expenses: PKR ${summary.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
      pageWidth - 14, finalY + 10, { align: 'right' },
    );
    await savePDF(doc, `Expense-Report-${format(new Date(), 'yyyy-MM-dd')}.pdf`, iOSWin);
    toast({ title: "Report downloaded", description: "The expense report PDF has been generated." });
  };

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  const Meta: React.FC<{ e: Expense }> = ({ e }) => {
    const k = e.karigarId ? karigars.find(x => x.id === e.karigarId) : null;
    const hisaab = e.batchId ? batchLabel.get(e.batchId) : null;
    const partner = e.shareholderId
      ? SHAREHOLDERS.find(x => x.id === e.shareholderId)?.name
      : null;
    if (!k && !partner && e.paidBy === 'business') return null;
    return (
      <div className="flex flex-wrap items-center gap-1 mt-1">
        {k && (
          <Badge variant="outline" className="text-2xs font-normal">
            <User className="h-3 w-3 mr-1" />{k.name}
          </Badge>
        )}
        {partner && (
          <Badge variant="outline" className="text-2xs font-normal">
            <User className="h-3 w-3 mr-1" />{partner}
          </Badge>
        )}
        {hisaab && (
          <Badge variant="secondary" className="text-2xs font-normal">
            <BookOpen className="h-3 w-3 mr-1" />{hisaab}
          </Badge>
        )}
        {e.paidBy && e.paidBy !== 'business' && (
          <Badge variant="outline" className="text-2xs font-normal capitalize">paid by {e.paidBy}</Badge>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl space-y-4">
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingExpense ? 'Edit expense' : 'Add expense'}</DialogTitle>
          </DialogHeader>
          <ExpenseForm key={editingExpense?.id ?? 'new'} expense={editingExpense} onSubmitSuccess={handleFormSuccess} />
        </DialogContent>
      </Dialog>

      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5">
            <CreditCard className="w-7 h-7 flex-shrink-0" />Expenses
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {periodLabel}
            {range && <> · {format(range.start, 'd MMM')} – {format(range.end, 'd MMM yyyy')}</>}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">
          <Button variant="outline" size="sm" onClick={handlePrintReport} disabled={!settings || filteredExpenses.length === 0}>
            <FileText className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Report</span>
          </Button>
          <Button size="sm" onClick={handleAddNew}>
            <PlusCircle className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Add expense</span><span className="sm:hidden">Add</span>
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Total expenses</p>
          <p className="text-base sm:text-xl md:text-2xl font-bold text-primary leading-tight truncate">{PKR(summary.total)}</p>
        </div>
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Payments</p>
          <p className="text-base sm:text-xl md:text-2xl font-bold leading-tight">{summary.count}</p>
        </div>
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Average per {graduation}</p>
          <p className="text-base sm:text-xl md:text-2xl font-bold leading-tight truncate">{PKR(summary.perBucket)}</p>
        </div>
        <div className="rounded-xl border bg-card p-2.5 sm:p-3.5 min-w-0">
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Karigar payments</p>
          <p className="text-base sm:text-xl md:text-2xl font-bold leading-tight truncate">{PKR(summary.karigarTotal)}</p>
          <p className="text-2xs text-muted-foreground">{summary.karigarShare}% of total</p>
        </div>
      </div>

      <FilterBar
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search by description, category, or karigar…"
        actions={
          <div className="inline-flex rounded-md border overflow-hidden flex-shrink-0" role="group" aria-label="Group by">
            {GRADUATIONS.map(g => (
              <button
                key={g.id} type="button" onClick={() => setGraduation(g.id)}
                aria-pressed={graduation === g.id}
                className={cn(
                  'px-2.5 text-xs h-9 transition-colors',
                  graduation === g.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        }
        footer={period === 'custom'
          ? <DateRangePicker date={customRange} onDateChange={setCustomRange} className="w-full sm:w-auto" />
          : undefined}
      >
        <Select value={period} onValueChange={v => setPeriod(v as PeriodId)}>
          <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All categories</SelectItem>
            {EXPENSE_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      {isExpensesLoading ? (
        <ListSkeleton rows={5} />
      ) : groups.length > 0 ? (
        <div className="space-y-4">
          {groups.map(g => (
            <section key={g.key}>
              <div className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <h2 className="text-sm font-semibold truncate">{g.label}</h2>
                  {g.sub && <span className="text-2xs text-muted-foreground flex-shrink-0">{g.sub}</span>}
                </div>
                <div className="flex items-baseline gap-2 flex-shrink-0">
                  <span className="text-2xs text-muted-foreground">{g.rows.length} item{g.rows.length === 1 ? '' : 's'}</span>
                  <span className="text-sm font-semibold tabular-nums">{PKR(g.total)}</span>
                </div>
              </div>

              <div className="md:hidden space-y-2">
                {g.rows.map(e => (
                  <SwipeToDelete key={e.id} onDelete={() => handleDeleteExpense(e.id)} className="rounded-lg border overflow-hidden">
                    <div className="bg-card p-3">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{e.description}</p>
                          <p className="text-2xs text-muted-foreground mt-0.5">
                            {format(parseISO(e.date), 'd MMM')} · {e.category}
                          </p>
                          <Meta e={e} />
                        </div>
                        <button
                          type="button" onClick={() => handleEditExpense(e)}
                          className="text-right flex-shrink-0" aria-label={`Edit ${e.description}`}
                        >
                          <span className="font-semibold text-sm tabular-nums">{PKR(e.amount)}</span>
                          <span className="block text-2xs text-muted-foreground">Edit</span>
                        </button>
                      </div>
                    </div>
                  </SwipeToDelete>
                ))}
              </div>

              <Card className="hidden md:block">
                <CardContent className="p-0 scroll-shadow-x overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[7rem]">Date</TableHead>
                        <TableHead className="w-[10rem]">Category</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right w-[9rem]">Amount</TableHead>
                        <TableHead className="w-[6rem] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.rows.map(e => (
                        <TableRow key={e.id}>
                          <TableCell className="text-sm text-muted-foreground">{format(parseISO(e.date), 'd MMM yyyy')}</TableCell>
                          <TableCell className="text-sm">{e.category}</TableCell>
                          <TableCell className="min-w-0">
                            <span className="block truncate">{e.description}</span>
                            <Meta e={e} />
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{PKR(e.amount)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button variant="ghost" size="icon" onClick={() => handleEditExpense(e)} aria-label={`Edit ${e.description}`}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={`Delete ${e.description}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {e.description} — {PKR(e.amount)}. This cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDeleteExpense(e.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      ) : (
        <div className="text-center py-14 bg-card rounded-xl border">
          <CreditCard className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">No expenses in this period</h3>
          <p className="text-sm text-muted-foreground">
            {searchTerm || categoryFilter !== 'All'
              ? 'Select a wider period, or clear the filters.'
              : `No expenses recorded for ${periodLabel.toLowerCase()}.`}
          </p>
        </div>
      )}
    </div>
  );
}
