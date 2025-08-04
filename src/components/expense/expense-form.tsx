
"use client";

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAppStore, Expense, EXPENSE_CATEGORIES } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Save, Ban, Calendar, DollarSign, Type } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const expenseSchema = z.object({
  date: z.date({ required_error: "A date is required." }),
  category: z.string().min(1, "Category is required"),
  description: z.string().min(1, "Description is required"),
  amount: z.coerce.number().min(0.01, "Amount must be a positive number"),
});

type ExpenseFormData = z.infer<typeof expenseSchema>;

interface ExpenseFormProps {
  expense?: Expense;
  onSubmitSuccess: () => void;
}

export const ExpenseForm: React.FC<ExpenseFormProps> = ({ expense, onSubmitSuccess }) => {
  const { toast } = useToast();
  const { addExpense, updateExpense } = useAppStore();

  const form = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseSchema),
    defaultValues: expense ? {
      ...expense,
      date: new Date(expense.date),
    } : {
      date: new Date(),
      category: '',
      description: '',
      amount: 0,
    },
  });

  const isEditMode = !!expense;
  const isOtherCategory = !EXPENSE_CATEGORIES.includes(form.watch('category') as any) && form.watch('category') !== '';

  const onSubmit = async (data: ExpenseFormData) => {
    try {
      if (isEditMode && expense) {
        await updateExpense(expense.id, { ...data, date: data.date.toISOString() });
        toast({ title: "Success", description: "Expense updated successfully." });
      } else {
        await addExpense({ ...data, date: data.date.toISOString() });
        toast({ title: "Success", description: "Expense added successfully." });
      }
      onSubmitSuccess();
    } catch (error) {
      toast({ title: "Error", description: "Failed to save expense.", variant: "destructive" });
      console.error("Failed to save expense", error);
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
              <FormLabel className="flex items-center"><Calendar className="mr-2 h-4 w-4"/> Date</FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                      {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date > new Date() || date < new Date("1900-01-01")} initialFocus />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center"><Type className="mr-2 h-4 w-4"/> Category</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an expense category" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                  <SelectItem value="Other">Other...</SelectItem>
                </SelectContent>
              </Select>
               {isOtherCategory && (
                <FormControl>
                  <Input {...field} placeholder="Enter custom category" className="mt-2" />
                </FormControl>
              )}
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
                <Textarea placeholder="e.g., Monthly K-Electric bill, Office lunch" {...field} />
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
              <FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/> Amount (PKR)</FormLabel>
              <FormControl>
                <Input type="number" step="0.01" placeholder="Enter the total amount" {...field} />
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
            <Save className="mr-2 h-4 w-4" /> {isEditMode ? 'Save Changes' : 'Add Expense'}
          </Button>
        </div>
      </form>
    </Form>
  );
};
