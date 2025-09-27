

"use client";

import React, { useMemo, useState } from 'react';
import { useAppStore, HisaabEntry, Customer, Karigar, Settings } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useForm, Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';


// Re-declare module for jsPDF in this file as well
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const hisaabEntrySchema = z.object({
  description: z.string().min(1, "Description is required"),
  amount: z.coerce.number().min(0, "Amount must be non-negative").default(0),
  goldGrams: z.coerce.number().min(0, "Gold must be non-negative").default(0),
});

type HisaabEntryFormData = z.infer<typeof hisaabEntrySchema>;
type PhoneForm = { phone: string; };
type TransactionMode = 'gave' | 'got';

const AddTransactionDialog: React.FC<{
    mode: TransactionMode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: HisaabEntryFormData) => Promise<void>;
    entityType: 'customer' | 'karigar';
}> = ({ mode, open, onOpenChange, onSubmit, entityType }) => {
    const form = useForm<HisaabEntryFormData>({
        resolver: zodResolver(hisaabEntrySchema),
        defaultValues: { description: '', amount: 0, goldGrams: 0 }
    });

    const isGaveMode = mode === 'gave';
    const isKarigar = entityType === 'karigar';

    const handleFormSubmit = async (data: HisaabEntryFormData) => {
        await onSubmit(data);
        form.reset();
        onOpenChange(false);
    };
    
    // For karigars, gold is primary. For customers, cash is primary.
    const primaryField = isKarigar ? 'goldGrams' : 'amount';
    const secondaryField = isKarigar ? 'amount' : 'goldGrams';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className={cn("flex items-center gap-2", isGaveMode ? 'text-destructive' : 'text-green-600')}>
                        {isGaveMode ? <ArrowUp /> : <ArrowDown />}
                        {isGaveMode ? 'You Gave' : 'You Got'}
                    </DialogTitle>
                    <DialogDescription>
                        Record a transaction for money or gold you {isGaveMode ? 'gave to' : 'received from'} this person.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4 py-4">
                        <FormField control={form.control} name="description" render={({ field }) => (
                            <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="e.g., Cash payment received, Sample given" {...field} /></FormControl><FormMessage /></FormItem>
                        )}/>
                        <FormField control={form.control} name={primaryField} render={({ field }) => (
                            <FormItem>
                                <FormLabel>{isKarigar ? 'Gold (grams)' : 'Cash Amount (PKR)'}</FormLabel>
                                <FormControl><Input type="number" step={isKarigar ? "0.001" : "0.01"} {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )}/>
                         <FormField control={form.control} name={secondaryField} render={({ field }) => (
                            <FormItem>
                                <FormLabel>{isKarigar ? 'Cash Amount (PKR)' : 'Gold (grams)'}</FormLabel>
                                <FormControl><Input type="number" step={isKarigar ? "0.01" : "0.001"} {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )}/>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={form.formState.isSubmitting} className={cn(isGaveMode ? 'bg-destructive hover:bg-destructive/90' : 'bg-green-600 hover:bg-green-700')}>
                                {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <Save className="mr-2 h-4 w-4"/>}
                                Save Transaction
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
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

  const { entityHisaab, balances } = useMemo(() => {
    let cashBalance = 0;
    let goldBalance = 0;
    const entries = hisaabEntries
      .filter(entry => entry.entityId === entityId)
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime()) // sort ascending for running balance
      .map(entry => {
          cashBalance += (entry.cashDebit - entry.cashCredit);
          goldBalance += (entry.goldDebitGrams - entry.goldCreditGrams);
          return { ...entry, runningCashBalance: cashBalance, runningGoldBalance: goldBalance };
      })
      .reverse(); // reverse back for display
    
    return {
        entityHisaab: entries,
        balances: { finalCashBalance: cashBalance, finalGoldBalance: goldBalance }
    };
  }, [hisaabEntries, entityId]);

  const { givenEntries, gotEntries } = useMemo(() => {
    const given = entityHisaab.filter(e => e.cashDebit > 0 || e.goldDebitGrams > 0);
    const got = entityHisaab.filter(e => e.cashCredit > 0 || e.goldCreditGrams > 0);
    return { givenEntries: given, gotEntries: got };
  }, [entityHisaab]);
  
  const phoneForm = useForm<PhoneForm>({ defaultValues: { phone: '' } });

  React.useEffect(() => {
    if (entity && entityType === 'customer' && (entity as Customer).phone) {
        phoneForm.setValue('phone', (entity as Customer).phone || '');
    }
  }, [entity, entityType, phoneForm]);

  
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<TransactionMode>('gave');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isReminderOpen, setIsReminderOpen] = useState(false);
  
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
    
    const newEntryData: Omit<HisaabEntry, 'id'> = {
        entityId: entity.id,
        entityType: entityType,
        entityName: entity.name,
        date: new Date().toISOString(),
        description: data.description,
        cashDebit: dialogMode === 'gave' ? data.amount : 0,
        cashCredit: dialogMode === 'got' ? data.amount : 0,
        goldDebitGrams: dialogMode === 'gave' ? data.goldGrams : 0,
        goldCreditGrams: dialogMode === 'got' ? data.goldGrams : 0,
    };

    const result = await addHisaabEntry(newEntryData);
    if(result) {
        toast({ title: "Success", description: "New hisaab entry added." });
    } else {
        toast({ title: "Error", description: "Failed to add hisaab entry.", variant: "destructive" });
    }
  };

  const handleSendReminder = () => {
    if (!settings) return;
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
    setIsReminderOpen(false);
  };
  
  const handlePrintLedger = () => {
    if (!entity || !settings) {
        toast({ title: "Error", description: "Entity or settings data is not available for printing.", variant: "destructive" });
        return;
    }
    
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
    const tableRows = entityHisaab.map(entry => [
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

  const isLoading = !appReady || isHisaabLoading || isCustomersLoading || isKarigarsLoading;

  if (isLoading) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Ledger...</p>
      </div>
    );
  }
  
  if (!entity) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <AlertTriangle className="h-8 w-8 text-destructive mr-3" />
        <p className="text-lg text-muted-foreground">Entity not found. It may have been deleted.</p>
      </div>
    );
  }

  const isKarigar = entityType === 'karigar';

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
       <AddTransactionDialog mode={dialogMode} open={isDialogOpen} onOpenChange={setIsDialogOpen} onSubmit={onAddEntry} entityType={entityType} />
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
                <p className="text-sm font-semibold">You will Get (Receivable)</p>
                <p className={cn("text-2xl font-bold", isKarigar && 'text-base font-normal')}>
                    PKR {Math.max(0, balances.finalCashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                 <p className={cn("text-lg font-bold", !isKarigar && 'text-base font-normal')}>
                    {Math.max(0, balances.finalGoldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })} g
                </p>
            </div>
             <div className="p-4 rounded-lg bg-green-500/10 text-green-700 dark:text-green-400">
                <p className="text-sm font-semibold">You will Give (Payable)</p>
                <p className={cn("text-2xl font-bold", isKarigar && 'text-base font-normal')}>
                    PKR {Math.abs(Math.min(0, balances.finalCashBalance)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                 <p className={cn("text-lg font-bold", !isKarigar && 'text-base font-normal')}>
                    {Math.abs(Math.min(0, balances.finalGoldBalance)).toLocaleString(undefined, { minimumFractionDigits: 3 })} g
                </p>
            </div>
        </CardContent>
         <CardFooter className="flex flex-wrap gap-2">
            <Button onClick={handlePrintLedger} variant="outline" disabled={!settings}>
                <FileText className="mr-2 h-4 w-4" /> Download PDF Report
            </Button>
            {entityType === 'customer' && balances.finalCashBalance > 0 && (
                <Dialog open={isReminderOpen} onOpenChange={setIsReminderOpen}>
                    <DialogTrigger asChild>
                        <Button variant="default" disabled={!settings}>
                            <MessageSquare className="mr-2 h-4 w-4" /> Send Reminder
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Send Payment Reminder</DialogTitle>
                            <DialogDescription>
                                This will open WhatsApp with a pre-filled reminder message for the outstanding balance.
                            </DialogDescription>
                        </DialogHeader>
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
                        <DialogFooter>
                            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                            <Button onClick={handleSendReminder}>Send</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </CardFooter>
      </Card>

      <div className="space-y-4">
        <Card>
            <CardHeader>
                <CardTitle>Transaction History</CardTitle>
                <CardDescription>A chronological log of all transactions with {entity.name}.</CardDescription>
            </CardHeader>
            <CardContent>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    <Button variant="default" className="bg-destructive hover:bg-destructive/90" size="lg" onClick={() => { setDialogMode('gave'); setIsDialogOpen(true); }}>
                        <ArrowUp className="mr-2 h-5 w-5"/> You Gave
                    </Button>
                     <Button variant="default" className="bg-green-600 hover:bg-green-700" size="lg" onClick={() => { setDialogMode('got'); setIsDialogOpen(true); }}>
                        <ArrowDown className="mr-2 h-5 w-5"/> You Got
                    </Button>
                </div>
                
                {entityHisaab.length > 0 ? (
                    <>
                    {/* Mobile View */}
                    <div className="md:hidden grid grid-cols-1 gap-4">
                        <div className="space-y-3">
                            <h3 className="font-semibold text-lg text-destructive flex items-center"><ArrowUp className="mr-2 h-5 w-5"/>You Gave (Debit)</h3>
                            {givenEntries.length > 0 ? givenEntries.map(entry => (
                                <div key={entry.id} className="p-3 border rounded-md bg-muted/30">
                                    <p className="text-sm font-semibold">{entry.description}</p>
                                    <p className="text-xs text-muted-foreground">{format(parseISO(entry.date), 'PP')}</p>
                                    <div className="text-right mt-1">
                                        {entry.cashDebit > 0 && <p className="font-bold text-sm text-destructive">PKR {entry.cashDebit.toLocaleString()}</p>}
                                        {entry.goldDebitGrams > 0 && <p className="font-bold text-sm text-destructive">{entry.goldDebitGrams.toLocaleString(undefined, {minimumFractionDigits: 3})} g</p>}
                                    </div>
                                </div>
                            )) : <p className="text-sm text-muted-foreground text-center py-4">No debit transactions.</p>}
                        </div>
                        <Separator/>
                        <div className="space-y-3">
                             <h3 className="font-semibold text-lg text-green-600 flex items-center"><ArrowDown className="mr-2 h-5 w-5"/>You Got (Credit)</h3>
                              {gotEntries.length > 0 ? gotEntries.map(entry => (
                                <div key={entry.id} className="p-3 border rounded-md bg-muted/30">
                                    <p className="text-sm font-semibold">{entry.description}</p>
                                    <p className="text-xs text-muted-foreground">{format(parseISO(entry.date), 'PP')}</p>
                                    <div className="text-right mt-1">
                                        {entry.cashCredit > 0 && <p className="font-bold text-sm text-green-600">PKR {entry.cashCredit.toLocaleString()}</p>}
                                        {entry.goldCreditGrams > 0 && <p className="font-bold text-sm text-green-600">{entry.goldCreditGrams.toLocaleString(undefined, {minimumFractionDigits: 3})} g</p>}
                                    </div>
                                </div>
                            )) : <p className="text-sm text-muted-foreground text-center py-4">No credit transactions.</p>}
                        </div>
                    </div>
                    {/* Desktop View */}
                    <div className="hidden md:block">
                        <ScrollArea className="h-[60vh] w-full">
                            <Table>
                                <TableHeader className="sticky top-0 bg-muted z-10">
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Description</TableHead>
                                        <TableHead className="text-right">Given</TableHead>
                                        <TableHead className="text-right">Received</TableHead>
                                        <TableHead className="text-right">Gold Balance</TableHead>
                                        <TableHead className="text-right">Cash Balance</TableHead>
                                        <TableHead className="w-10"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {entityHisaab.map(entry => (
                                        <TableRow key={entry.id}>
                                            <TableCell className="whitespace-nowrap">{format(parseISO(entry.date), 'dd-MMM-yy')}</TableCell>
                                            <TableCell className="max-w-xs truncate">{entry.description}</TableCell>
                                            <TableCell className="text-right font-medium text-destructive">
                                                {entry.cashDebit > 0 && <div className="text-xs">PKR {entry.cashDebit.toLocaleString()}</div>}
                                                {entry.goldDebitGrams > 0 && <div className="text-sm">{entry.goldDebitGrams.toLocaleString(undefined, {minimumFractionDigits: 3})} g</div>}
                                                {(entry.goldDebitGrams === 0 && entry.cashDebit === 0) && '-'}
                                            </TableCell>
                                            <TableCell className="text-right font-medium text-green-600">
                                                {entry.cashCredit > 0 && <div className="text-xs">PKR {entry.cashCredit.toLocaleString()}</div>}
                                                {entry.goldCreditGrams > 0 && <div className="text-sm">{entry.goldCreditGrams.toLocaleString(undefined, {minimumFractionDigits: 3})} g</div>}
                                                {(entry.goldCreditGrams === 0 && entry.cashCredit === 0) && '-'}
                                            </TableCell>
                                            <TableCell className={cn("text-right font-semibold", entry.runningGoldBalance < 0 ? 'text-green-600' : 'text-destructive')}>
                                                {entry.runningGoldBalance.toLocaleString(undefined, {minimumFractionDigits: 3})} g
                                            </TableCell>
                                            <TableCell className={cn("text-right font-semibold", entry.runningCashBalance < 0 ? 'text-green-600' : 'text-destructive')}>
                                                PKR {entry.runningCashBalance.toLocaleString()}
                                            </TableCell>
                                            <TableCell>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" disabled={isDeleting === entry.id} className="h-8 w-8">
                                                            {isDeleting === entry.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive"/>}
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
                        </ScrollArea>
                    </div>
                    </>
                ) : (
                    <p className="text-center text-muted-foreground py-8">No transactions found. Add one using the buttons above.</p>
                )}
            </CardContent>
        </Card>
      </div>
    </div>
  );
}

    

    
