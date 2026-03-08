"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useAppStore, GivenItem, GivenItemStatus, GivenItemRecipientType } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Search, PlusCircle, Edit, Trash2, Loader2, HandCoins,
  CheckCircle2, Clock, Calendar, Users, Briefcase, User,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

// ── Schema ────────────────────────────────────────────────────────────────────
const givenSchema = z.object({
  date: z.date({ required_error: 'Date is required.' }),
  description: z.string().min(1, 'Description is required.'),
  recipientType: z.enum(['karigar', 'customer', 'other'] as const),
  recipientName: z.string().min(1, 'Recipient name is required.'),
  notes: z.string().optional(),
});
type GivenFormData = z.infer<typeof givenSchema>;

// ── Form ──────────────────────────────────────────────────────────────────────
function GivenItemForm({
  item,
  onSubmitSuccess,
}: {
  item?: GivenItem;
  onSubmitSuccess: () => void;
}) {
  const { toast } = useToast();
  const { addGivenItem, updateGivenItem, karigars, customers, loadKarigars, loadCustomers } = useAppStore();
  const isEdit = !!item;

  useEffect(() => {
    loadKarigars();
    loadCustomers();
  }, [loadKarigars, loadCustomers]);

  const form = useForm<GivenFormData>({
    resolver: zodResolver(givenSchema),
    defaultValues: item
      ? {
          date: new Date(item.date),
          description: item.description,
          recipientType: item.recipientType,
          recipientName: item.recipientName,
          notes: item.notes ?? '',
        }
      : {
          date: new Date(),
          description: '',
          recipientType: 'karigar',
          recipientName: '',
          notes: '',
        },
  });

  const recipientType = form.watch('recipientType');

  const onSubmit = async (data: GivenFormData) => {
    const payload: Omit<GivenItem, 'id'> = {
      date: data.date.toISOString(),
      description: data.description,
      recipientType: data.recipientType,
      recipientName: data.recipientName,
      notes: data.notes || '',
      status: item?.status ?? 'out',
      returnedDate: item?.returnedDate,
    };
    try {
      if (isEdit && item) {
        await updateGivenItem(item.id, payload);
        toast({ title: 'Updated', description: 'Item updated.' });
      } else {
        await addGivenItem(payload);
        toast({ title: 'Added', description: 'Item recorded as given.' });
      }
      onSubmitSuccess();
    } catch {
      toast({ title: 'Error', description: 'Failed to save.', variant: 'destructive' });
    }
  };

  // Autocomplete candidates based on recipient type
  const recipientSuggestions = useMemo(() => {
    if (recipientType === 'karigar') return karigars.map(k => k.name);
    if (recipientType === 'customer') return customers.map(c => c.name);
    return [];
  }, [recipientType, karigars, customers]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 pt-2">
        {/* Date */}
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date Given</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button variant="outline" className={cn('w-full pl-3 text-left font-normal', !field.value && 'text-muted-foreground')}>
                      {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                      <Calendar className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent mode="single" selected={field.value} onSelect={field.onChange} initialFocus />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Item / Description</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Gold ring sample, Silver bangle repair…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Recipient type */}
        <FormField
          control={form.control}
          name="recipientType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Given To (Type)</FormLabel>
              <Select onValueChange={(v) => { field.onChange(v); form.setValue('recipientName', ''); }} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="karigar">Karigar</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Recipient name — datalist suggestions */}
        <FormField
          control={form.control}
          name="recipientName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Recipient Name</FormLabel>
              <FormControl>
                <>
                  <Input list="recipient-suggestions" placeholder="Name…" {...field} />
                  <datalist id="recipient-suggestions">
                    {recipientSuggestions.map(n => <option key={n} value={n} />)}
                  </datalist>
                </>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Notes */}
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea placeholder="Any extra details…" rows={2} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2 pt-2">
          <Button type="submit" className="flex-1">{isEdit ? 'Update' : 'Save'}</Button>
        </div>
      </form>
    </Form>
  );
}

// ── Recipient badge ────────────────────────────────────────────────────────────
const RECIPIENT_ICON: Record<GivenItemRecipientType, React.ReactNode> = {
  karigar: <Briefcase className="w-3 h-3" />,
  customer: <Users className="w-3 h-3" />,
  other: <User className="w-3 h-3" />,
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function GivenItemsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | GivenItemStatus>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GivenItem | undefined>();

  const appReady = useAppReady();
  const { givenItems, isGivenItemsLoading, loadGivenItems, deleteGivenItem, markGivenItemReturned } = useAppStore();
  const { toast } = useToast();

  useEffect(() => {
    if (appReady) loadGivenItems();
  }, [appReady, loadGivenItems]);

  const filtered = useMemo(() => {
    return givenItems
      .filter(g => statusFilter === 'all' ? true : g.status === statusFilter)
      .filter(g =>
        g.description.toLowerCase().includes(search.toLowerCase()) ||
        g.recipientName.toLowerCase().includes(search.toLowerCase()) ||
        (g.notes ?? '').toLowerCase().includes(search.toLowerCase())
      );
  }, [givenItems, search, statusFilter]);

  const outCount = givenItems.filter(g => g.status === 'out').length;
  const returnedCount = givenItems.filter(g => g.status === 'returned').length;

  const handleMarkReturned = async (item: GivenItem) => {
    try {
      await markGivenItemReturned(item.id, new Date().toISOString());
      toast({ title: 'Marked as Returned', description: item.description });
    } catch {
      toast({ title: 'Error', description: 'Could not update item.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGivenItem(id);
      toast({ title: 'Deleted' });
    } catch {
      toast({ title: 'Error', description: 'Could not delete item.', variant: 'destructive' });
    }
  };

  const openAdd = () => { setEditingItem(undefined); setIsFormOpen(true); };
  const openEdit = (item: GivenItem) => { setEditingItem(item); setIsFormOpen(true); };

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <header className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2">
            <HandCoins className="w-7 h-7" /> Given Items
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Track samples, repairs, or anything given to karigars or customers.
          </p>
        </div>
        <Button onClick={openAdd}>
          <PlusCircle className="w-4 h-4 mr-2" /> Record Item Given
        </Button>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Still Out</p>
            <p className="text-2xl font-bold text-amber-500">{outCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Returned</p>
            <p className="text-2xl font-bold text-green-600">{returnedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total</p>
            <p className="text-2xl font-bold">{givenItems.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-5">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Input
              placeholder="Search by item or recipient…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          </div>
          <div className="flex gap-2">
            {(['all', 'out', 'returned'] as const).map(s => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? 'default' : 'outline'}
                onClick={() => setStatusFilter(s)}
                className="capitalize"
              >
                {s === 'all' ? 'All' : s === 'out' ? 'Still Out' : 'Returned'}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {isGivenItemsLoading ? (
        <div className="text-center py-12">
          <Loader2 className="w-10 h-10 mx-auto animate-spin text-primary mb-3" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-lg shadow">
          <HandCoins className="w-14 h-14 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-1">Nothing here yet</h3>
          <p className="text-muted-foreground text-sm">
            {search || statusFilter !== 'all' ? 'No items match your filter.' : 'Tap "Record Item Given" to get started.'}
          </p>
        </div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Item / Description</TableHead>
                <TableHead>Given To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(item => (
                <TableRow key={item.id} className={item.status === 'returned' ? 'opacity-60' : ''}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {format(parseISO(item.date), 'd MMM yy')}
                  </TableCell>
                  <TableCell className="font-medium">{item.description}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{RECIPIENT_ICON[item.recipientType]}</span>
                      <span className="text-sm">{item.recipientName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.status === 'out' ? (
                      <Badge variant="outline" className="border-amber-400 text-amber-600 gap-1">
                        <Clock className="w-3 h-3" /> Out
                      </Badge>
                    ) : (
                      <div>
                        <Badge variant="outline" className="border-green-500 text-green-600 gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Returned
                        </Badge>
                        {item.returnedDate && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {format(parseISO(item.returnedDate), 'd MMM yy')}
                          </p>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">
                    {item.notes || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end items-center gap-1">
                      {item.status === 'out' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-green-700 border-green-400 hover:bg-green-50"
                          onClick={() => handleMarkReturned(item)}
                        >
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Got Back
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(item)}>
                        <Edit className="w-3.5 h-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                            <AlertDialogDescription>
                              &quot;{item.description}&quot; — given to {item.recipientName}. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(item.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Given Item' : 'Record Item Given'}</DialogTitle>
          </DialogHeader>
          <GivenItemForm
            key={editingItem?.id ?? 'new'}
            item={editingItem}
            onSubmitSuccess={() => setIsFormOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
