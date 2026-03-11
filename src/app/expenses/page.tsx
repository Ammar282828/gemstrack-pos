

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore, Expense, EXPENSE_CATEGORIES } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, PlusCircle, Edit, Trash2, CreditCard, Loader2, Filter, FileText, User, ChevronDown } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { ExpenseForm } from '@/components/expense/expense-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, parseISO, isWithinInterval, endOfDay } from 'date-fns';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from "react-day-picker";
import { cn, openPDFWindowForIOS, savePDF } from '@/lib/utils';
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
import { SwipeToDelete } from '@/components/ui/swipe-to-delete';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// Re-declare module for jsPDF in this file as well
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

export default function ExpensesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | undefined>(undefined);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  const appReady = useAppReady();
  const { expenses, deleteExpense, isExpensesLoading, loadExpenses, settings, karigars, loadKarigars } = useAppStore();
  const { toast } = useToast();

  useEffect(() => {
    if (appReady) {
      loadExpenses();
      loadKarigars();
    }
  }, [appReady, loadExpenses, loadKarigars]);

  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteExpense(id);
      toast({ title: "Expense Deleted", description: "The expense record has been deleted." });
    } catch (err) {
      console.error('Failed to delete expense:', err);
      toast({ title: "Delete Failed", description: "Could not delete the expense. Please try again.", variant: "destructive" });
    }
  };

  const handleEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
    setIsFormOpen(true);
  };

  const handleAddNew = () => {
    setEditingExpense(undefined);
    setIsFormOpen(true);
  };
  
  const handleFormSuccess = () => {
      setIsFormOpen(false);
      setEditingExpense(undefined);
  };

  const filteredExpenses = useMemo(() => {
    if (!appReady) return [];
    return expenses
      .filter(expense => {
        if (categoryFilter !== 'All' && expense.category !== categoryFilter) return false;
        
        if (dateRange?.from) {
            const expenseDate = parseISO(expense.date);
            const toDate = endOfDay(dateRange.to || new Date());
            return isWithinInterval(expenseDate, { start: dateRange.from, end: toDate });
        }
        
        return true; // No date filter applied
      })
      .filter(expense =>
        expense.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        expense.category.toLowerCase().includes(searchTerm.toLowerCase())
      )
      .sort((a,b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [expenses, searchTerm, appReady, dateRange, categoryFilter]);
  
  const summaryData = useMemo(() => {
    return {
        totalAmount: filteredExpenses.reduce((acc, exp) => acc + exp.amount, 0),
        transactionCount: filteredExpenses.length,
    }
  }, [filteredExpenses]);

  const handlePrintReport = () => {
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
        `Date Range: ${dateRange?.from ? `${format(dateRange.from, 'PP')} to ${format(dateRange.to || new Date(), 'PP')}` : 'All Time'}`,
        `Category: ${categoryFilter}`,
        `Search Term: ${searchTerm || 'None'}`
    ].join(' | ');
    doc.text(`Filters: ${filterSummary}`, 14, 29);

    const tableColumns = ["Date", "Category", "Description", "Amount (PKR)"];
    const tableRows = filteredExpenses.map(exp => [
        format(parseISO(exp.date), 'dd-MMM-yyyy'),
        exp.category,
        exp.description,
        exp.amount.toLocaleString(undefined, {minimumFractionDigits: 2}),
    ]);

    doc.autoTable({
        head: [tableColumns],
        body: tableRows,
        startY: 40,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
        columnStyles: { 3: { halign: 'right' } }
    });
    
    // Add total row
    const finalY = (doc as any).lastAutoTable.finalY;
    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.text(
        `Total Expenses: PKR ${summaryData.totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}`,
        pageWidth - 14,
        finalY + 10,
        { align: 'right' }
    );

    savePDF(doc, `Expense-Report-${format(new Date(), 'yyyy-MM-dd')}.pdf`, iOSWin);
    toast({ title: "Report Downloaded", description: "Expense report PDF has been generated." });
  };


  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading expenses...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 px-3 md:py-8 md:px-4">
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingExpense ? 'Edit Expense' : 'Add New Expense'}</DialogTitle>
          </DialogHeader>
          <ExpenseForm key={editingExpense?.id ?? 'new'} expense={editingExpense} onSubmitSuccess={handleFormSuccess} />
        </DialogContent>
      </Dialog>

      <header className="mb-4 flex flex-row justify-between items-center gap-2">
        <h1 className="text-xl md:text-3xl font-bold text-primary flex items-center gap-2">
          <CreditCard className="w-6 h-6 md:w-8 md:h-8 flex-shrink-0"/>Expenses
        </h1>
        <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePrintReport} disabled={!settings || filteredExpenses.length === 0}>
                <FileText className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Download Report</span>
            </Button>
            <Button size="sm" onClick={handleAddNew}>
                <PlusCircle className="w-4 h-4 md:mr-2" /><span className="hidden md:inline">Add New Expense</span><span className="md:hidden">Add</span>
            </Button>
        </div>
      </header>

      <Card className="mb-4">
        <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-primary/5 rounded-lg p-3 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Total Expenses</p>
                    <p className="text-sm md:text-2xl font-bold text-primary leading-tight break-all">PKR {summaryData.totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Transactions</p>
                    <p className="text-lg md:text-2xl font-bold">{summaryData.transactionCount}</p>
                </div>
            </div>
          <div className="relative flex-grow w-full">
            <Input
              type="search"
              placeholder="Search by description or category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          </div>
           <div className="flex flex-col sm:flex-row gap-3">
                <DateRangePicker date={dateRange} onDateChange={setDateRange} className="w-full sm:w-auto" />
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-sm font-medium text-muted-foreground flex items-center flex-shrink-0"><Filter className="w-4 h-4 mr-1"/>Category:</span>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="flex-1 sm:w-48">
                            <SelectValue placeholder="All Categories" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="All">All</SelectItem>
                            {EXPENSE_CATEGORIES.map((cat) => (
                                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </CardContent>
      </Card>

      {isExpensesLoading ? (
         <div className="text-center py-12">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Refreshing expense list...</p>
         </div>
      ) : filteredExpenses.length > 0 ? (
        <>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {filteredExpenses.map((expense) => {
              const k = expense.karigarId ? karigars.find(k => k.id === expense.karigarId) : null;
              return (
                <SwipeToDelete key={expense.id} onDelete={() => handleDeleteExpense(expense.id)} className="rounded-lg border overflow-hidden">
                <Card className="border-0 shadow-none rounded-none">
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{expense.description}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <Badge variant="secondary" className="text-xs">{expense.category}</Badge>
                          {k && <Badge variant="outline" className="text-xs"><User className="h-3 w-3 mr-1"/>{k.name}</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{format(parseISO(expense.date), 'MMM dd, yyyy')}</p>
                      </div>
                      <p className="font-bold text-primary text-sm text-right break-all">PKR {expense.amount.toLocaleString()}</p>
                    </div>
                    <div className="flex justify-end gap-1 mt-3 border-t pt-2">
                      <Button variant="ghost" size="sm" onClick={() => handleEditExpense(expense)}>
                        <Edit className="h-4 w-4 mr-1" /> Edit
                      </Button>
                    </div>
                  </CardContent>
                </Card>
                </SwipeToDelete>
              );
            })}
          </div>
          {/* Desktop: Table */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount (PKR)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell>{format(parseISO(expense.date), 'MMM dd, yyyy')}</TableCell>
                    <TableCell>{expense.category}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span>{expense.description}</span>
                        {expense.karigarId && (() => {
                          const k = karigars.find(k => k.id === expense.karigarId);
                          return k ? <Badge variant="outline" className="text-xs w-fit"><User className="h-3 w-3 mr-1"/>{k.name}</Badge> : null;
                        })()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{expense.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEditExpense(expense)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the expense record. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteExpense(expense.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>

      ) : (
        <div className="text-center py-12 bg-card rounded-lg shadow">
          <CreditCard className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Expenses Found</h3>
          <p className="text-muted-foreground">
            {searchTerm || dateRange || categoryFilter !== 'All' ? "Try adjusting your search or filters." : "Add an expense to get started!"}
          </p>
        </div>
      )}
    </div>
  );
}
