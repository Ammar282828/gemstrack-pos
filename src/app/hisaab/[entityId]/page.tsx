
"use client";

import React, { useMemo, useState } from 'react';
import { useAppStore, HisaabEntry, Customer, Karigar, useAppReady, Settings } from '@/lib/store';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useForm, Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, BookUser, ArrowLeft, User, Briefcase, PlusCircle, Save, ArrowDown, ArrowUp, Trash2, AlertTriangle, FileText, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
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
import PhoneInput from 'react-phone-number-input/react-hook-form-input';
import 'react-phone-number-input/style.css'
import { Label } from '@/components/ui/label';

// Re-declare module for jsPDF in this file as well
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const hisaabEntrySchema = z.object({
  description: z.string().min(1, "Description is required"),
  cashGot: z.coerce.number().default(0), // Money you receive
  cashGave: z.coerce.number().default(0), // Money you give
  goldGotGrams: z.coerce.number().default(0), // Gold you receive
  goldGaveGrams: z.coerce.number().default(0), // Gold you give
});

type HisaabEntryFormData = z.infer<typeof hisaabEntrySchema>;
type PhoneForm = {
    phone: string;
};


export default function EntityHisaabPage() {
  const appReady = useAppReady();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const entityId = params.entityId as string;
  const entityType = searchParams.get('type') as 'customer' | 'karigar';

  const { customers, karigars, hisaabEntries, addHisaabEntry, deleteHisaabEntry, settings, isHisaabLoading, isCustomersLoading, isKarigarsLoading } = useAppStore();

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

  const phoneForm = useForm<PhoneForm>({ defaultValues: { phone: (entity as Customer)?.phone || '' } });
  
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

  const handleSendReminder = () => {
    const whatsAppNumber = phoneForm.getValues('phone');
    if (!whatsAppNumber) {
        toast({ title: "No Phone Number", description: "Please enter the customer's phone number.", variant: "destructive" });
        return;
    }
    if (!entity || balances.finalCashBalance <= 0) {
        toast({ title: "No Outstanding Balance", description: "This customer does not have a receivable balance.", variant: "default" });
        return;
    }

    let message = `Dear ${entity.name},\n\n`;
    message += `This is a friendly reminder from ${settings.shopName} regarding your outstanding balance.\n\n`;
    message += `*Amount Due:* PKR ${balances.finalCashBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    message += `We would appreciate it if you could settle the balance at your earliest convenience.\n\n`;
    message += `Thank you!`;

    const numberOnly = whatsAppNumber.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${numberOnly}?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
    toast({ title: "Redirecting to WhatsApp", description: "Your reminder message is ready to be sent." });
  };
  
  const handlePrintLedger = () => {
    if (!entity) return;
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;

    // Header
    doc.setFont("helvetica", "bold").setFontSize(18);
    doc.text(`Ledger Statement`, margin, 22);
    doc.setFontSize(12);
    doc.text(entity.name, margin, 29);
    doc.setFontSize(10);
    doc.text(`(${entityType})`, margin, 35);
    
    doc.setFont("helvetica", "normal").setFontSize(10);
    doc.text(`Date: ${format(new Date(), 'PP')}`, pageWidth - margin, 22, { align: 'right' });
    
    // Balance Summary
    let summaryY = 50;
    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.text("Final Balance", margin, summaryY);
    summaryY += 7;

    doc.setFont("helvetica", "normal").setFontSize(10);
    const cashBalanceText = balances.finalCashBalance > 0 
        ? `Receivable: PKR ${balances.finalCashBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}`
        : `Payable: PKR ${Math.abs(balances.finalCashBalance).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    doc.text(`Cash: ${cashBalanceText}`, margin, summaryY);
    summaryY += 7;
    
    const goldBalanceText = balances.finalGoldBalance > 0
        ? `Receivable: ${balances.finalGoldBalance.toLocaleString(undefined, {minimumFractionDigits: 3})}g`
        : `Payable: ${Math.abs(balances.finalGoldBalance).toLocaleString(undefined, {minimumFractionDigits: 3})}g`;
    doc.text(`Gold: ${goldBalanceText}`, margin, summaryY);
    
    // Table
    const tableStartY = summaryY + 15;
    const tableColumns = ["Date", "Description", "Cash Given (-)", "Cash Got (+)", "Gold Given (g)", "Gold Got (g)"];
    const tableRows = balances.entriesWithRunningBalance.map(entry => [
        format(parseISO(entry.date), 'dd-MMM-yy'),
        entry.description,
        entry.cashDebit > 0 ? entry.cashDebit.toLocaleString() : '-',
        entry.cashCredit > 0 ? entry.cashCredit.toLocaleString() : '-',
        entry.goldDebitGrams > 0 ? entry.goldDebitGrams.toLocaleString(undefined, { minimumFractionDigits: 3 }) : '-',
        entry.goldCreditGrams > 0 ? entry.goldCreditGrams.toLocaleString(undefined, { minimumFractionDigits: 3 }) : '-',
    ]);

    doc.autoTable({
        head: [tableColumns],
        body: tableRows,
        startY: tableStartY,
        theme: 'grid',
        headStyles: { fillColor: [240, 240, 240], textColor: 50, fontStyle: 'bold', fontSize: 9, },
        styles: { fontSize: 8, cellPadding: 2, valign: 'middle' },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 'auto' },
            2: { halign: 'right' },
            3: { halign: 'right' },
            4: { halign: 'right' },
            5: { halign: 'right' },
        }
    });

    doc.save(`Ledger-${entity.name}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
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
         <CardFooter className="flex flex-wrap gap-2">
            <Button onClick={handlePrintLedger} variant="outline">
                <FileText className="mr-2 h-4 w-4" /> Download PDF Report
            </Button>
            {entityType === 'customer' && balances.finalCashBalance > 0 && (
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="default">
                            <MessageSquare className="mr-2 h-4 w-4" /> Send Reminder
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Send Payment Reminder</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will open WhatsApp with a pre-filled reminder message for the outstanding balance.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                         <div className="py-4 space-y-2">
                             <Label htmlFor="whatsapp-number">Customer WhatsApp Number</Label>
                             <PhoneInput
                                name="phone"
                                control={phoneForm.control as unknown as Control}
                                defaultCountry="PK"
                                international
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                            />
                        </div>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleSendReminder}>Send</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </CardFooter>
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
