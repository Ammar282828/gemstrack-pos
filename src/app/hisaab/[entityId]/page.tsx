
"use client";

import React, { useMemo, useState } from 'react';
import { useAppStore, HisaabEntry, Customer, Karigar, useAppReady } from '@/lib/store';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, BookUser, ArrowLeft, User, Briefcase, PlusCircle, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

const hisaabEntrySchema = z.object({
  description: z.string().min(1, "Description is required"),
  cashDebit: z.coerce.number().default(0),
  cashCredit: z.coerce.number().default(0),
  goldDebitGrams: z.coerce.number().default(0),
  goldCreditGrams: z.coerce.number().default(0),
});

type HisaabEntryFormData = z.infer<typeof hisaabEntrySchema>;

export default function EntityHisaabPage() {
  const appReady = useAppReady();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const entityId = params.entityId as string;
  const entityType = searchParams.get('type') as 'customer' | 'karigar';

  const { customers, karigars, hisaabEntries, addHisaabEntry, isHisaabLoading, isCustomersLoading, isKarigarsLoading } = useAppStore();

  const entity: Customer | Karigar | undefined = useMemo(() => {
    if (entityType === 'customer') {
      return customers.find(c => c.id === entityId);
    }
    return karigars.find(k => k.id === entityId);
  }, [entityId, entityType, customers, karigars]);

  const entityHisaab = useMemo(() => {
    return hisaabEntries
      .filter(entry => entry.entityId === entityId)
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [hisaabEntries, entityId]);

  const balances = useMemo(() => {
    let cashBalance = 0;
    let goldBalance = 0;
    // Iterate backwards to calculate running balance correctly with sorted entries
    const entriesWithRunningBalance = [...entityHisaab].reverse().map(entry => {
      cashBalance += (entry.cashDebit - entry.cashCredit);
      goldBalance += (entry.goldDebitGrams - entry.goldCreditGrams);
      return { ...entry, runningCashBalance: cashBalance, runningGoldBalance: goldBalance };
    }).reverse();

    return {
      finalCashBalance: cashBalance,
      finalGoldBalance: goldBalance,
      entriesWithRunningBalance,
    };
  }, [entityHisaab]);
  
  const form = useForm<HisaabEntryFormData>({
    resolver: zodResolver(hisaabEntrySchema),
    defaultValues: {
      description: '',
      cashDebit: 0,
      cashCredit: 0,
      goldDebitGrams: 0,
      goldCreditGrams: 0,
    }
  });

  const onAddEntry = async (data: HisaabEntryFormData) => {
    if (!entity) return;
    
    const newEntryData: Omit<HisaabEntry, 'id'> = {
        entityId: entity.id,
        entityType: entityType,
        entityName: entity.name,
        date: new Date().toISOString(),
        description: data.description,
        cashDebit: data.cashDebit,
        cashCredit: data.cashCredit,
        goldDebitGrams: data.goldDebitGrams,
        goldCreditGrams: data.goldCreditGrams,
    };

    const result = await addHisaabEntry(newEntryData);
    if(result) {
        toast({ title: "Success", description: "New hisaab entry added." });
        form.reset();
    } else {
        toast({ title: "Error", description: "Failed to add hisaab entry.", variant: "destructive" });
    }
  };


  if (!appReady || isHisaabLoading || isCustomersLoading || isKarigarsLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Ledger...</p>
      </div>
    );
  }

  if (!entity) {
    return (
        <div className="container mx-auto p-4 text-center">
            <h2 className="text-2xl font-semibold">Entity not found</h2>
            <p className="text-muted-foreground">The customer or karigar with ID "{entityId}" could not be found.</p>
            <Button variant="link" className="mt-4" onClick={() => router.push('/hisaab')}>Go back to Hisaab Summary</Button>
        </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
       <header className="mb-2">
         <Button variant="outline" onClick={() => router.back()} className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Summary
        </Button>
        <h1 className="text-3xl font-bold text-primary flex items-center">
            {entityType === 'customer' ? <User className="mr-3 h-8 w-8"/> : <Briefcase className="mr-3 h-8 w-8"/>}
            Ledger for {entity.name}
        </h1>
        <p className="text-muted-foreground">Detailed transaction history and running balance.</p>
      </header>

      <Card>
        <CardHeader>
            <CardTitle>Current Balances</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`p-4 rounded-lg ${balances.finalCashBalance >= 0 ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
                <p className="text-sm text-muted-foreground">Cash Balance (PKR)</p>
                <p className={`text-2xl font-bold ${balances.finalCashBalance >= 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {Math.abs(balances.finalCashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs">{balances.finalCashBalance >= 0 ? 'Receivable (They owe you)' : 'Payable (You owe them)'}</p>
            </div>
             <div className={`p-4 rounded-lg ${balances.finalGoldBalance >= 0 ? 'bg-red-500/10' : 'bg-green-500/10'}`}>
                <p className="text-sm text-muted-foreground">Gold Balance (grams)</p>
                <p className={`text-2xl font-bold ${balances.finalGoldBalance >= 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {Math.abs(balances.finalGoldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })}
                </p>
                 <p className="text-xs">{balances.finalGoldBalance >= 0 ? 'Receivable (They owe you)' : 'Payable (You owe them)'}</p>
            </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <Card>
                <CardHeader>
                    <CardTitle>Transaction History</CardTitle>
                </CardHeader>
                <CardContent>
                    {balances.entriesWithRunningBalance.length > 0 ? (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead className="text-right">Cash (PKR)</TableHead>
                                    <TableHead className="text-right">Gold (g)</TableHead>
                                    <TableHead className="text-right">Balance</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {balances.entriesWithRunningBalance.map(entry => (
                                    <TableRow key={entry.id}>
                                        <TableCell>{format(parseISO(entry.date), 'MMM d, yyyy')}</TableCell>
                                        <TableCell>{entry.description}</TableCell>
                                        <TableCell className="text-right">
                                            {entry.cashDebit > 0 && <span className="text-destructive">+{entry.cashDebit.toLocaleString()}</span>}
                                            {entry.cashCredit > 0 && <span className="text-green-600">-{entry.cashCredit.toLocaleString()}</span>}
                                        </TableCell>
                                         <TableCell className="text-right">
                                            {entry.goldDebitGrams > 0 && <span className="text-destructive">+{entry.goldDebitGrams.toLocaleString(undefined, {minimumFractionDigits: 3})}</span>}
                                            {entry.goldCreditGrams > 0 && <span className="text-green-600">-{entry.goldCreditGrams.toLocaleString(undefined, {minimumFractionDigits: 3})}</span>}
                                        </TableCell>
                                        <TableCell className="text-right text-xs">
                                           <div className={`${entry.runningCashBalance >= 0 ? 'text-destructive' : 'text-green-600'}`}>
                                             PKR {Math.abs(entry.runningCashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                           </div>
                                            <div className={`${entry.runningGoldBalance >= 0 ? 'text-destructive' : 'text-green-600'}`}>
                                             {Math.abs(entry.runningGoldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })} g
                                           </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    ) : (
                        <p className="text-center text-muted-foreground py-8">No transactions found for {entity.name}.</p>
                    )}
                </CardContent>
            </Card>
        </div>
        <div>
            <Card className="sticky top-8">
                <CardHeader>
                    <CardTitle>Add New Entry</CardTitle>
                    <CardDescription>Manually add a transaction to this ledger.</CardDescription>
                </CardHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onAddEntry)}>
                        <CardContent className="space-y-4">
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Description</FormLabel>
                                    <FormControl><Textarea placeholder="e.g., Cash payment received" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            <Separator />
                            <p className="text-sm font-medium">Cash Transaction (PKR)</p>
                             <FormField
                                control={form.control}
                                name="cashDebit"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Debit (They Owe You)</FormLabel>
                                    <FormControl><Input type="number" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                             <FormField
                                control={form.control}
                                name="cashCredit"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Credit (You Owe Them / They Paid)</FormLabel>
                                    <FormControl><Input type="number" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            <Separator />
                            <p className="text-sm font-medium">Gold Transaction (grams)</p>
                            <FormField
                                control={form.control}
                                name="goldDebitGrams"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Debit (They Owe You)</FormLabel>
                                    <FormControl><Input type="number" step="0.001" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="goldCreditGrams"
                                render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Credit (You Owe Them / They Returned)</FormLabel>
                                    <FormControl><Input type="number" step="0.001" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                                )}
                            />
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                                {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                                Save Entry
                            </Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>
        </div>
      </div>
    </div>
  );
}
