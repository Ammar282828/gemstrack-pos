"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore, AdditionalRevenue } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Search, PlusCircle, Edit, Trash2, Loader2, Save, Ban, Calendar, DollarSign, TrendingUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import type { DateRange } from 'react-day-picker';
import { format, parseISO, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';

// ── Form schema ──────────────────────────────────────────────────────────────
const revenueSchema = z.object({
  date: z.date({ required_error: 'A date is required.' }),
  description: z.string().min(1, 'Description is required'),
  amount: z.coerce.number().min(0.01, 'Amount must be a positive number'),
});
type RevenueFormData = z.infer<typeof revenueSchema>;

// ── Inline form component ─────────────────────────────────────────────────────
function RevenueForm({
  revenue,
  onSubmitSuccess,
}: {
  revenue?: AdditionalRevenue;
  onSubmitSuccess: () => void;
}) {
  const { toast } = useToast();
  const { addAdditionalRevenue, updateAdditionalRevenue } = useAppStore();
  const isEditMode = !!revenue;

  const form = useForm<RevenueFormData>({
    resolver: zodResolver(revenueSchema),
    defaultValues: revenue
      ? { ...revenue, date: new Date(revenue.date) }
      : { date: new Date(), description: '', amount: 0 },
  });

  const onSubmit = async (data: RevenueFormData) => {
    const payload = { ...data, date: data.date.toISOString() };
    try {
      if (isEditMode && revenue) {
        await updateAdditionalRevenue(revenue.id, payload);
        toast({ title: 'Updated', description: 'Revenue entry updated.' });
      } else {
        await addAdditionalRevenue(payload);
        toast({ title: 'Added', description: 'Revenue entry added.' });
      }
      onSubmitSuccess();
    } catch {
      toast({ title: 'Error', description: 'Failed to save revenue entry.', variant: 'destructive' });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-4">
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="flex items-center"><Calendar className="mr-2 h-4 w-4" />Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant="outline"
                      className={cn('w-full pl-3 text-left font-normal', !field.value && 'text-muted-foreground')}
                    >
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <Calendar className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea placeholder="e.g., Commission from partner, Refund received" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4" />Amount (PKR)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="0" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onSubmitSuccess}>
            <Ban className="mr-2 h-4 w-4" /> Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Revenue'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdditionalRevenuePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRevenue, setEditingRevenue] = useState<AdditionalRevenue | undefined>(undefined);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined);

  const appReady = useAppReady();
  const { additionalRevenues, deleteAdditionalRevenue, isAdditionalRevenueLoading, loadAdditionalRevenues } = useAppStore();
  const { toast } = useToast();

  useEffect(() => {
    if (appReady) loadAdditionalRevenues();
  }, [appReady, loadAdditionalRevenues]);

  const handleDelete = async (id: string) => {
    await deleteAdditionalRevenue(id);
    toast({ title: 'Deleted', description: 'Revenue entry deleted.' });
  };

  const handleEdit = (revenue: AdditionalRevenue) => {
    setEditingRevenue(revenue);
    setIsFormOpen(true);
  };

  const handleAddNew = () => {
    setEditingRevenue(undefined);
    setIsFormOpen(true);
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setEditingRevenue(undefined);
  };

  const filtered = useMemo(() => {
    if (!appReady) return [];
    return additionalRevenues
      .filter((r) => {
        if (dateRange?.from) {
          const d = parseISO(r.date);
          return isWithinInterval(d, { start: dateRange.from, end: dateRange.to ?? new Date() });
        }
        return true;
      })
      .filter((r) => r.description.toLowerCase().includes(searchTerm.toLowerCase()))
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [additionalRevenues, searchTerm, appReady, dateRange]);

  const total = useMemo(() => filtered.reduce((sum, r) => sum + r.amount, 0), [filtered]);

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading revenue entries...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRevenue ? 'Edit Revenue Entry' : 'Add Revenue Entry'}</DialogTitle>
          </DialogHeader>
          <RevenueForm revenue={editingRevenue} onSubmitSuccess={handleFormSuccess} />
        </DialogContent>
      </Dialog>

      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center">
            <TrendingUp className="w-8 h-8 mr-3" /> Additional Revenue
          </h1>
          <p className="text-muted-foreground">Record extra income not tied to an order or invoice.</p>
        </div>
        <Button size="lg" onClick={handleAddNew}>
          <PlusCircle className="w-5 h-5 mr-2" /> Add Revenue Entry
        </Button>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filters & Summary</CardTitle>
          <CardDescription>Refine by date range or search by description.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-primary/5 p-4">
              <p className="text-sm font-medium text-muted-foreground">Total Revenue for Period</p>
              <p className="text-3xl font-bold text-primary">
                PKR {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </Card>
            <Card className="bg-muted/50 p-4">
              <p className="text-sm font-medium text-muted-foreground">Total Entries</p>
              <p className="text-3xl font-bold">{filtered.length}</p>
            </Card>
          </div>
          <div className="relative w-full">
            <Input
              type="search"
              placeholder="Search by description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          </div>
          <DateRangePicker date={dateRange} onDateChange={setDateRange} className="w-full sm:w-auto" />
        </CardContent>
      </Card>

      {isAdditionalRevenueLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
          <p className="text-muted-foreground">Loading revenue entries...</p>
        </div>
      ) : filtered.length > 0 ? (
        <>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{r.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{format(parseISO(r.date), 'MMM dd, yyyy')}</p>
                    </div>
                    <p className="font-bold text-primary flex-shrink-0">PKR {r.amount.toLocaleString()}</p>
                  </div>
                  <div className="flex justify-end gap-1 mt-3 border-t pt-2">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(r)}>
                      <Edit className="h-4 w-4 mr-1" /> Edit
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4 mr-1" /> Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete revenue entry?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete &ldquo;{r.description}&rdquo;. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(r.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {/* Desktop: Table */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount (PKR)</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{format(parseISO(r.date), 'MMM dd, yyyy')}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell className="text-right font-medium">{r.amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete revenue entry?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete &ldquo;{r.description}&rdquo;. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(r.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
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
          <TrendingUp className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Revenue Entries Found</h3>
          <p className="text-muted-foreground">
            {searchTerm || dateRange
              ? 'Try adjusting your search or filters.'
              : 'Add a revenue entry to get started.'}
          </p>
        </div>
      )}
    </div>
  );
}
