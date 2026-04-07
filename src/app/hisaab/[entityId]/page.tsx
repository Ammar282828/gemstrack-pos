

"use client";

import React, { useMemo, useState } from 'react';
import { useAppStore, HisaabEntry, Customer, Karigar, Settings } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useForm, Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, BookUser, ArrowLeft, User, Briefcase, PlusCircle, Save, ArrowDown, ArrowUp, Trash2, AlertTriangle, FileText, MessageSquare, ExternalLink } from 'lucide-react';
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
import { cn, normalizePhoneNumber, openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SwipeToDelete } from '@/components/ui/swipe-to-delete';


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
}).superRefine((data, ctx) => {
  if (data.amount === 0 && data.goldGrams === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a cash amount or gold grams — both cannot be zero.", path: ['amount'] });
  }
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


  const phoneForm = useForm<PhoneForm>({ defaultValues: { phone: '' } });

  React.useEffect(() => {
    if (entity && entityType === 'customer' && (entity as Customer).phone) {
        phoneForm.setValue('phone', normalizePhoneNumber((entity as Customer).phone));
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
  
  const handlePrintLedger = async () => {
    if (!entity || !settings) {
        toast({ title: "Error", description: "Entity or settings data is not available for printing.", variant: "destructive" });
        return;
    }

    const iOSWin = openPDFWindowForIOS();
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
    
    // Table — sorted oldest-first for the printed statement
    const tableStartY = summaryY + 15;
    const tableColumns = ["Date", "Description", "Debit (Dr)", "Credit (Cr)", "Gold Out (g)", "Gold In (g)"];
    const pdfEntries = [...entityHisaab].reverse(); // ascending date order for statement
    const tableRows = pdfEntries.map(entry => [
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

    await savePDF(doc, `Ledger-${entity.name}-${format(new Date(), 'yyyy-MM-dd')}.pdf`, iOSWin);
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
    <div className="container mx-auto py-4 px-3 md:py-8 md:px-4 space-y-4">
       <AddTransactionDialog mode={dialogMode} open={isDialogOpen} onOpenChange={setIsDialogOpen} onSubmit={onAddEntry} entityType={entityType} />
       <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={() => router.back()} className="flex-shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg md:text-2xl font-bold text-primary flex items-center gap-2 truncate">
              {entityType === 'customer' ? <User className="h-5 w-5 flex-shrink-0"/> : <Briefcase className="h-5 w-5 flex-shrink-0"/>}
              {entity.name}
            </h1>
            <p className="text-xs text-muted-foreground capitalize">{entityType} ledger</p>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button size="sm" variant="outline" onClick={handlePrintLedger} disabled={!settings}>
            <FileText className="h-4 w-4 md:mr-2"/><span className="hidden md:inline">PDF</span>
          </Button>
          {entityType === 'customer' && balances.finalCashBalance > 0 && (
            <Dialog open={isReminderOpen} onOpenChange={setIsReminderOpen}>
              <DialogTrigger asChild>
                <Button size="sm" disabled={!settings}>
                  <MessageSquare className="h-4 w-4 md:mr-2"/><span className="hidden md:inline">Remind</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Send Payment Reminder</DialogTitle>
                  <DialogDescription>Opens WhatsApp with a pre-filled reminder for the outstanding balance.</DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-2">
                  <Label htmlFor="whatsapp-number">Customer WhatsApp Number</Label>
                  <PhoneInput name="phone" control={phoneForm.control as unknown as Control} defaultCountry="PK" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm" />
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                  <Button onClick={handleSendReminder}>Send</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-green-600/10 border border-green-600/20">
          <p className="text-xs font-medium text-green-700 dark:text-green-500 mb-1">You will Get</p>
          <p className="text-xl font-bold text-green-700 dark:text-green-500">PKR {Math.max(0, balances.finalCashBalance).toLocaleString()}</p>
          {balances.finalGoldBalance > 0 && <p className="text-xs text-green-600/80 mt-0.5">{balances.finalGoldBalance.toLocaleString(undefined, {minimumFractionDigits: 3})} g</p>}
        </div>
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-xs font-medium text-destructive mb-1">You will Give</p>
          <p className="text-xl font-bold text-destructive">PKR {Math.abs(Math.min(0, balances.finalCashBalance)).toLocaleString()}</p>
          {balances.finalGoldBalance < 0 && <p className="text-xs text-destructive/80 mt-0.5">{Math.abs(balances.finalGoldBalance).toLocaleString(undefined, {minimumFractionDigits: 3})} g</p>}
        </div>
      </div>

      <div className="space-y-3">
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">Transactions</CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={() => { setDialogMode('gave'); setIsDialogOpen(true); }}>
                        <ArrowUp className="mr-1.5 h-3.5 w-3.5"/> You Gave
                    </Button>
                    <Button size="sm" variant="outline" className="text-green-700 border-green-700/40 hover:bg-green-700/10 dark:text-green-500" onClick={() => { setDialogMode('got'); setIsDialogOpen(true); }}>
                        <ArrowDown className="mr-1.5 h-3.5 w-3.5"/> You Got
                    </Button>
                  </div>
                </div>
            </CardHeader>
            <CardContent>
                
                {entityHisaab.length > 0 ? (
                    <>
                    {/* Mobile View — chronological, single list */}
                    <div className="md:hidden space-y-3">
                        {entityHisaab.map(entry => {
                          return (
                            <SwipeToDelete key={entry.id} onDelete={() => onDeleteEntry(entry.id)} className="rounded-lg border overflow-hidden">
                              <Card className="border-0 shadow-none rounded-none">
                                <CardContent className="p-4">
                                  <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <p className="font-semibold truncate">{entry.description}</p>
                                        {entry.linkedInvoiceId && (
                                          <a href={`/cart?invoice_id=${entry.linkedInvoiceId}`} className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors" title={`Open ${entry.linkedInvoiceId} to record payment`}>
                                            <ExternalLink className="h-3.5 w-3.5" />
                                          </a>
                                        )}
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-1">{format(parseISO(entry.date), 'MMM dd, yyyy')}</p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      {entry.cashDebit > 0 && <p className="font-bold text-destructive text-sm">-PKR {entry.cashDebit.toLocaleString()}</p>}
                                      {entry.cashCredit > 0 && <p className="font-bold text-green-700 dark:text-green-500 text-sm">+PKR {entry.cashCredit.toLocaleString()}</p>}
                                      {entry.goldDebitGrams > 0 && <p className="text-xs text-destructive">-{entry.goldDebitGrams.toFixed(3)}g</p>}
                                      {entry.goldCreditGrams > 0 && <p className="text-xs text-green-700 dark:text-green-500">+{entry.goldCreditGrams.toFixed(3)}g</p>}
                                      <p className={cn('text-xs mt-0.5', entry.runningCashBalance === 0 ? 'text-muted-foreground' : entry.runningCashBalance > 0 ? 'text-green-700/70 dark:text-green-500/70' : 'text-destructive/70')}>
                                        Bal: PKR {entry.runningCashBalance.toLocaleString()}
                                      </p>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            </SwipeToDelete>
                          );
                        })}
                    </div>
                    {/* Desktop View */}
                    <div className="hidden md:block">
                        <Table>
                            <TableHeader className="bg-muted">
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Description</TableHead>
                                    <TableHead className="text-right">Given</TableHead>
                                    <TableHead className="text-right">Received</TableHead>
                                    {entityHisaab.some(e => e.goldDebitGrams > 0 || e.goldCreditGrams > 0) && (
                                      <TableHead className="text-right">Gold Balance</TableHead>
                                    )}
                                    <TableHead className="text-right">Cash Balance</TableHead>
                                    <TableHead className="w-10"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {entityHisaab.map(entry => (
                                    <TableRow key={entry.id}>
                                        <TableCell className="whitespace-nowrap text-muted-foreground text-sm">{format(parseISO(entry.date), 'dd-MMM-yy')}</TableCell>
                                        <TableCell className="max-w-xs">
                                            <div className="flex items-center gap-1.5">
                                              <span className="truncate">{entry.description}</span>
                                              {entry.linkedInvoiceId && (
                                                <a href={`/cart?invoice_id=${entry.linkedInvoiceId}`} className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors" title={`Open ${entry.linkedInvoiceId} to record payment`}>
                                                  <ExternalLink className="h-3.5 w-3.5" />
                                                </a>
                                              )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-medium text-destructive">
                                            {entry.cashDebit > 0 && <div>PKR {entry.cashDebit.toLocaleString()}</div>}
                                            {entry.goldDebitGrams > 0 && <div className="text-xs">{entry.goldDebitGrams.toFixed(3)} g</div>}
                                            {(entry.goldDebitGrams === 0 && entry.cashDebit === 0) && <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell className="text-right font-medium text-green-600">
                                            {entry.cashCredit > 0 && <div>PKR {entry.cashCredit.toLocaleString()}</div>}
                                            {entry.goldCreditGrams > 0 && <div className="text-xs">{entry.goldCreditGrams.toFixed(3)} g</div>}
                                            {(entry.goldCreditGrams === 0 && entry.cashCredit === 0) && <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        {entityHisaab.some(e => e.goldDebitGrams > 0 || e.goldCreditGrams > 0) && (
                                          <TableCell className={cn("text-right font-semibold", entry.runningGoldBalance === 0 ? 'text-muted-foreground' : entry.runningGoldBalance < 0 ? 'text-green-600' : 'text-destructive')}>
                                              {entry.runningGoldBalance.toFixed(3)} g
                                          </TableCell>
                                        )}
                                        <TableCell className={cn("text-right font-semibold", entry.runningCashBalance === 0 ? 'text-muted-foreground' : entry.runningCashBalance > 0 ? 'text-destructive' : 'text-green-600')}>
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
                                                        <AlertDialogDescription>This will permanently delete the transaction: "{entry.description}".</AlertDialogDescription>
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
