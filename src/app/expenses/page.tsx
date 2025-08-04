
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore, Expense, useAppReady, EXPENSE_CATEGORIES } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, PlusCircle, Edit, Trash2, CreditCard, Loader2, Filter, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ExpenseForm } from '@/components/expense/expense-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from "react-day-picker";
import { cn } from '@/lib/utils';
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
  const { expenses, deleteExpense, isExpensesLoading, loadExpenses, settings } = useAppStore();
  const { toast } = useToast();

  useEffect(() => {
    if (appReady && !isExpensesLoading) {
      loadExpenses();
    }
  }, [appReady, isExpensesLoading, loadExpenses]);

  const handleDeleteExpense = async (id: string) => {
    await deleteExpense(id);
    toast({ title: "Expense Deleted", description: "The expense record has been deleted." });
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
            const toDate = dateRange.to || new Date(); // Use today if 'to' is not set
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

    doc.save(`Expense-Report-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
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
    <div className="container mx-auto py-8 px-4">
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingExpense ? 'Edit Expense' : 'Add New Expense'}</DialogTitle>
          </DialogHeader>
          <ExpenseForm expense={editingExpense} onSubmitSuccess={handleFormSuccess} />
        </DialogContent>
      </Dialog>

      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center">
            <CreditCard className="w-8 h-8 mr-3"/>Manage Expenses
          </h1>
          <p className="text-muted-foreground">Track all your operational costs and expenditures.</p>
        </div>
        <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrintReport} disabled={!settings || filteredExpenses.length === 0}>
                <FileText className="mr-2 h-4 w-4" /> Download Report
            </Button>
            <Button size="lg" onClick={handleAddNew}>
                <PlusCircle className="w-5 h-5 mr-2" />
                Add New Expense
            </Button>
        </div>
      </header>

      <Card className="mb-6">
        <CardHeader>
            <CardTitle>Filters & Summary</CardTitle>
            <CardDescription>Refine your view and see a summary of the selected period.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-primary/5 p-4">
                    <p className="text-sm font-medium text-muted-foreground">Total Expenses for Period</p>
                    <p className="text-3xl font-bold text-primary">PKR {summaryData.totalAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                </Card>
                 <Card className="bg-muted/50 p-4">
                    <p className="text-sm font-medium text-muted-foreground">Total Transactions</p>
                    <p className="text-3xl font-bold">{summaryData.transactionCount}</p>
                </Card>
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
           <div className="flex flex-col sm:flex-row gap-4">
                <DateRangePicker date={dateRange} onDateChange={setDateRange} className="w-full sm:w-auto" />
                <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-sm font-medium text-muted-foreground mr-2 flex items-center"><Filter className="w-4 h-4 mr-1"/>Category:</span>
                    <Button
                    variant={categoryFilter === 'All' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCategoryFilter('All')}
                    >All</Button>
                    {EXPENSE_CATEGORIES.map((cat) => (
                    <Button
                        key={cat}
                        variant={categoryFilter === cat ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setCategoryFilter(cat)}
                        >{cat}</Button>
                    ))}
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
        <Card>
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
                    <TableCell>{expense.description}</TableCell>
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
