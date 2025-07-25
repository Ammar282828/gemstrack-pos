
"use client";

import React, { useMemo, useState } from 'react';
import { useAppStore, HisaabEntry, Customer, Karigar, useAppReady } from '@/lib/store';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, BookUser, ArrowLeft, User, Briefcase, PlusCircle, Save, ArrowDown, ArrowUp, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
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

const hisaabEntrySchema = z.object({
  description: z.string().min(1, "Description is required"),
  cashGot: z.coerce.number().default(0), // Money you receive
  cashGave: z.coerce.number().default(0), // Money you give
  goldGotGrams: z.coerce.number().default(0), // Gold you receive
  goldGaveGrams: z.coerce.number().default(0), // Gold you give
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

  const { customers, karigars, hisaabEntries, addHisaabEntry, deleteHisaabEntry, isHisaabLoading, isCustomersLoading, isKarigarsLoading } = useAppStore();

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
      cashGot: 0,
      cashGave: 0,
      goldGotGrams: 0,
      goldGaveGrams: 0,
    }
  });
  
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  
  const onDeleteEntry = async (entryId: string) => {
      setIsDeleting(entryId);
      try {
        await deleteHisaabEntry(entryId);
        toast({ title: "Success", description: "Transaction deleted successfully." });
      } catch(e) {
          toast({ title: "Error", description: "Failed to delete transaction.", variant: "destructive" });
      } finally {
          setIsDeleting(null);
      }
  };


  const onAddEntry = async (data: HisaabEntryFormData) => {
    if (!entity) return;
    
    // cashGave (debit) means they owe you more
    // cashGot (credit) means they owe you less
    const newEntryData: Omit<HisaabEntry, 'id'> = {
        entityId: entity.id,
        entityType: entityType,
        entityName: entity.name,
        date: new Date().toISOString(),
        description: data.description,
        cashDebit: data.cashGave,
        cashCredit: data.cashGot,
        goldDebitGrams: data.goldGaveGrams,
        goldCreditGrams: data.goldGotGrams,
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
            <CardTitle>Final Balances</CardTitle>
            <CardDescription>
                A positive balance means they owe you (receivable). A negative balance means you owe them (payable).
            </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="p-4 rounded-lg bg-red-500/10 text-destructive">
                <p className="text-sm">Cash You Will Get (Receivable)</p>
                <p className="text-2xl font-bold">
                    PKR {Math.max(0, balances.finalCashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
            </div>
             <div className="p-4 rounded-lg bg-green-500/10 text-green-700 dark:text-green-400">
                <p className="text-sm">Cash You Will Give (Payable)</p>
                <p className="text-2xl font-bold">
                    PKR {Math.abs(Math.min(0, balances.finalCashBalance)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
            </div>
             <div className="p-4 rounded-lg bg-red-500/10 text-destructive">
                <p className="text-sm">Gold You Will Get (Receivable)</p>
                <p className="text-2xl font-bold">
                    {Math.max(0, balances.finalGoldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })} g
                </p>
            </div>
             <div className="p-4 rounded-lg bg-green-500/10 text-green-700 dark:text-green-400">
                <p className="text-sm">Gold You Will Give (Payable)</p>
                <p className="text-2xl font-bold">
                    {Math.abs(Math.min(0, balances.finalGoldBalance)).toLocaleString(undefined, { minimumFractionDigits: 3 })} g
                </p>
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
                        <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date & Description</TableHead>
                                    <TableHead className="text-right">Cash Gave (-)</TableHead>
                                    <TableHead className="text-right">Cash Got (+)</TableHead>
                                    <TableHead className="text-right">Gold Gave (g)</TableHead>
                                    <TableHead className="text-right">Gold Got (g)</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {balances.entriesWithRunningBalance.map(entry => (
                                    <TableRow key={entry.id}>
                                        <TableCell>
                                            <div className="font-medium">{entry.description}</div>
                                            <div className="text-xs text-muted-foreground">{format(parseISO(entry.date), 'MMM d, yyyy, h:mm a')}</div>
                                        </TableCell>
                                        <TableCell className="text-right text-destructive">{entry.cashDebit > 0 ? entry.cashDebit.toLocaleString() : '-'}</TableCell>
                                        <TableCell className="text-right text-green-600">{entry.cashCredit > 0 ? entry.cashCredit.toLocaleString() : '-'}</TableCell>
                                        <TableCell className="text-right text-destructive">{entry.goldDebitGrams > 0 ? entry.goldDebitGrams.toLocaleString(undefined, {minimumFractionDigits: 3}) : '-'}</TableCell>
                                        <TableCell className="text-right text-green-600">{entry.goldCreditGrams > 0 ? entry.goldCreditGrams.toLocaleString(undefined, {minimumFractionDigits: 3}) : '-'}</TableCell>
                                        <TableCell className="text-right">
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" disabled={isDeleting === entry.id}>
                                                        {isDeleting === entry.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4 text-destructive"/>}
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle className="flex items-center"><AlertTriangle className="h-5 w-5 mr-2"/>Are you sure?</AlertDialogTitle>
                                                        <AlertDialogDescription>This action cannot be undone. This will permanently delete the transaction: "{entry.description}".</AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => onDeleteEntry(entry.id)}>Delete</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>
                    ) : (
                        <p className="text-center text-muted-foreground py-8">No transactions found for {entity.name}.</p>
                    )}
                </CardContent>
            </Card>
        </div>
        <div>
            <Card className="sticky top-8">
                <CardHeader>
                    <CardTitle>Add New Transaction</CardTitle>
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
                            <div className="p-3 rounded-md bg-green-500/10">
                                <p className="text-sm font-bold text-green-700 dark:text-green-400 mb-2 flex items-center">
                                    <ArrowDown className="mr-2 h-4 w-4"/> You Got (Received)
                                </p>
                                 <FormField
                                    control={form.control}
                                    name="cashGot"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Cash Got (PKR)</FormLabel>
                                        <FormControl><Input type="number" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                                 <FormField
                                    control={form.control}
                                    name="goldGotGrams"
                                    render={({ field }) => (
                                    <FormItem className="mt-2">
                                        <FormLabel>Gold Got (grams)</FormLabel>
                                        <FormControl><Input type="number" step="0.001" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                            </div>
                            
                            <Separator />
                             <div className="p-3 rounded-md bg-red-500/10">
                                <p className="text-sm font-bold text-destructive mb-2 flex items-center">
                                   <ArrowUp className="mr-2 h-4 w-4"/> You Gave
                                </p>
                                <FormField
                                    control={form.control}
                                    name="cashGave"
                                    render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Cash Gave (PKR)</FormLabel>
                                        <FormControl><Input type="number" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="goldGaveGrams"
                                    render={({ field }) => (
                                    <FormItem className="mt-2">
                                        <FormLabel>Gold Gave (grams)</FormLabel>
                                        <FormControl><Input type="number" step="0.001" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                    )}
                                />
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                                {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Save className="mr-2 h-4 w-4"/>}
                                Save Transaction
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
