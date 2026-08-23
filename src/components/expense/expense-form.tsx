"use client";

/**
 * One expense.
 *
 * Two things it now gets right that it didn't. A karigar payment can be filed
 * straight into that karigar's open hisaab — before, only the karigar page
 * could do that, so anything entered here landed outside every hisaab and had
 * to be reconciled by hand. And the hisaab is optional on purpose: paying a
 * karigar outside a hisaab is a normal payment, not a defect, so it says so
 * rather than filing it under a bucket named for something else.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAppStore, Expense, EXPENSE_CATEGORIES } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, Briefcase, BookOpen } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { SearchablePicker } from '@/components/shared/searchable-picker';
import { KarigarPicker } from '@/components/karigar/karigar-picker';

const expenseSchema = z.object({
  date: z.date({ required_error: "A date is required." }),
  category: z.string().min(1, "Category is required"),
  description: z.string().min(1, "Description is required"),
  amount: z.coerce.number().min(0.01, "Amount must be a positive number"),
  paidBy: z.enum(['business', 'ammar', 'mina']).default('business'),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;

/** Sentinel for "deliberately not in a hisaab", distinct from "none chosen". */
const NO_HISAAB = '__direct__';

interface ExpenseFormProps {
  expense?: Expense;
  onSubmitSuccess: () => void;
  /** Pre-links to a karigar and hides the picker (opened from a karigar page). */
  lockedKarigarId?: string;
  /** Pre-assigns a hisaab and hides that picker too. */
  lockedBatchId?: string;
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({ expense, onSubmitSuccess, lockedKarigarId, lockedBatchId }) => {
  const { toast } = useToast();
  const { addExpense, updateExpense, karigars, loadKarigars, karigarBatches, loadKarigarBatches } = useAppStore();
  const [selectedKarigarId, setSelectedKarigarId] = useState(expense?.karigarId || lockedKarigarId || '');
  const [batchId, setBatchId] = useState<string>(expense?.batchId || '');
  const [touchedBatch, setTouchedBatch] = useState(!!expense);

  useEffect(() => { loadKarigars(); loadKarigarBatches(); }, [loadKarigars, loadKarigarBatches]);

  const form = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expense ? {
      ...expense,
      date: (() => {
        if (!expense.date) return new Date();
        // Firestore Timestamps arrive as objects, not strings.
        if (typeof (expense.date as any).toDate === 'function') return (expense.date as any).toDate();
        const d = new Date(expense.date as string);
        return isNaN(d.getTime()) ? new Date() : d;
      })(),
    } : {
      date: new Date(),
      category: '',
      description: '',
      amount: 0,
      paidBy: 'business',
    },
  });

  const isEditMode = !!expense;
  const effectiveKarigarId = lockedKarigarId || selectedKarigarId;

  /** That karigar's hisaabs, open one first — it is nearly always the answer. */
  const theirBatches = useMemo(() => {
    if (!effectiveKarigarId) return [];
    return (karigarBatches || [])
      .filter(b => b.karigarId === effectiveKarigarId)
      .sort((a, b) => {
        const openness = Number(!!a.closedDate) - Number(!!b.closedDate);
        if (openness) return openness;
        return new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime();
      });
  }, [karigarBatches, effectiveKarigarId]);

  const openBatch = theirBatches.find(b => !b.closedDate);

  // Picking a karigar preselects their open hisaab, because that is what you
  // almost always mean. Touching the hisaab field stops that from overriding
  // a deliberate choice on the next re-render.
  useEffect(() => {
    if (touchedBatch || lockedBatchId) return;
    setBatchId(openBatch ? openBatch.id : (effectiveKarigarId ? NO_HISAAB : ''));
  }, [openBatch, effectiveKarigarId, touchedBatch, lockedBatchId]);

  const onSubmit = async (data: ExpenseFormData) => {
    const chosenBatch = lockedBatchId || (batchId && batchId !== NO_HISAAB ? batchId : undefined);
    const payload: Omit<Expense, 'id'> = {
      ...data,
      date: data.date.toISOString(),
      ...(effectiveKarigarId && { karigarId: effectiveKarigarId }),
      ...(chosenBatch && { batchId: chosenBatch }),
    };
    try {
      if (isEditMode && expense) {
        // Clearing a hisaab has to write the removal, and Firestore rejects
        // undefined, so null it is — the same way ledgerEntryId is cleared.
        await updateExpense(expense.id, { ...payload, batchId: chosenBatch ?? null } as unknown as Partial<Expense>);
        toast({ title: "Saved", description: "Expense updated." });
      } else {
        await addExpense(payload);
        const where = chosenBatch
          ? theirBatches.find(b => b.id === chosenBatch)?.label
          : null;
        toast({
          title: "Expense added",
          description: where ? `Filed to hisaab “${where}”.` : 'Recorded.',
        });
      }
      onSubmitSuccess();
    } catch (error) {
      toast({ title: "Error", description: "Failed to save expense.", variant: "destructive" });
      console.error("Failed to save expense", error);
    }
  };

  const karigarName = karigars.find(k => k.id === effectiveKarigarId)?.name || effectiveKarigarId;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField control={form.control} name="date" render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button variant="outline" className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                      {field.value ? format(field.value, "d MMM yyyy") : <span>Select a date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent mode="single" selected={field.value} onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date("1900-01-01")} initialFocus />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}/>

          <FormField control={form.control} name="amount" render={({ field }) => (
            <FormItem>
              <FormLabel>Amount (PKR)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" inputMode="decimal" placeholder="0.00" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}/>
        </div>

        <FormField control={form.control} name="category" render={({ field }) => (
          <FormItem>
            <FormLabel>Category</FormLabel>
            <SearchablePicker
              value={field.value || ''}
              onChange={field.onChange}
              options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))}
              placeholder="Select a category"
              searchPlaceholder="Type a category…"
              allowCustom
              aria-label="Expense category"
            />
            <FormMessage />
          </FormItem>
        )}/>

        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea rows={2} placeholder="e.g. Monthly K-Electric bill" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}/>

        <FormField control={form.control} name="paidBy" render={({ field }) => (
          <FormItem>
            <FormLabel>Paid by</FormLabel>
            <SearchablePicker
              value={field.value || 'business'}
              onChange={field.onChange}
              options={[
                { value: 'business', label: 'Business cash' },
                { value: 'ammar', label: 'Ammar', hint: 'Personal — logged to his ledger as a loan' },
                { value: 'mina', label: 'Mina', hint: 'Personal — logged to her ledger as a loan' },
              ]}
              aria-label="Paid by"
            />
            <FormMessage />
          </FormItem>
        )}/>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5" />Karigar payment
          </p>

          {lockedKarigarId ? (
            <p className="text-sm">Paying <span className="font-medium">{karigarName}</span></p>
          ) : (
            <KarigarPicker
              value={selectedKarigarId || ''}
              onChange={v => { setSelectedKarigarId(v === 'none' ? '' : v); setTouchedBatch(false); }}
              placeholder="Not a karigar payment"
              clearLabel="Not a karigar payment"
              aria-label="Karigar this expense pays"
            />
          )}

          {effectiveKarigarId && !lockedBatchId && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />Add to a hisaab
              </p>
              {theirBatches.length > 0 ? (
                <SearchablePicker
                  value={batchId}
                  onChange={v => { setTouchedBatch(true); setBatchId(v || NO_HISAAB); }}
                  options={[
                    ...theirBatches.map(b => ({
                      value: b.id,
                      label: b.label,
                      hint: b.closedDate ? `Settled ${format(new Date(b.closedDate), 'd MMM yyyy')}` : 'Open',
                      group: b.closedDate ? 'Settled' : 'Open',
                    })),
                    { value: NO_HISAAB, label: 'Direct payment', hint: 'Outside any hisaab', group: 'Other' },
                  ]}
                  placeholder="Choose a hisaab"
                  searchPlaceholder="Search hisaabs…"
                  aria-label="Hisaab to file this payment under"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {karigarName} has no hisaab yet — this is recorded as a direct payment.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onSubmitSuccess}>
            <Ban className="mr-2 h-4 w-4" />Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting} aria-label="Save">
            <Save className="mr-2 h-4 w-4" />{isEditMode ? 'Save changes' : 'Add expense'}
          </Button>
        </div>
      </form>
    </Form>
  );
};
