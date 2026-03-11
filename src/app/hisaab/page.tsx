

"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAppStore, Customer, Karigar } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, BookUser, ArrowRight, User, Briefcase, ArrowDown, ArrowUp, Search, PlusCircle, FileText } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn, openPDFWindowForIOS, savePDF } from '@/lib/utils';


type AccountSummary = {
  entityId: string;
  entityName: string;
  entityType: 'customer' | 'karigar';
  cashBalance: number; 
  goldBalance: number; 
};

type CombinedContact = (Customer | Karigar) & { type: 'customer' | 'karigar' };

const AddNewHisaabDialog: React.FC<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    customers: Customer[];
    karigars: Karigar[];
}> = ({ open, onOpenChange, customers, karigars }) => {
    const router = useRouter();
    const [searchTerm, setSearchTerm] = useState('');

    const combinedContacts: CombinedContact[] = useMemo(() => {
        const allContacts: CombinedContact[] = [
            ...customers.map(c => ({...c, type: 'customer' as const})),
            ...karigars.map(k => ({...k, type: 'karigar' as const})),
        ];
        return allContacts.sort((a, b) => a.name.localeCompare(b.name));
    }, [customers, karigars]);

    const filteredContacts = useMemo(() => {
        if (!searchTerm) return combinedContacts;
        return combinedContacts.filter(contact =>
            contact.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [searchTerm, combinedContacts]);
    
    const handleSelectContact = (contact: CombinedContact) => {
        router.push(`/hisaab/${contact.id}?type=${contact.type}`);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Add or Select a Ledger</DialogTitle>
                    <DialogDescription>
                        Search for an existing person or create a new one to start a ledger.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="Search by name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>
                    <ScrollArea className="h-[300px] border rounded-md">
                         {filteredContacts.length > 0 ? (
                            <div className="p-2">
                                {filteredContacts.map(contact => (
                                    <button
                                        key={contact.id}
                                        onClick={() => handleSelectContact(contact)}
                                        className="w-full text-left p-2 rounded-md hover:bg-muted flex items-center gap-3"
                                    >
                                        {contact.type === 'customer' 
                                            ? <User className="h-5 w-5 text-muted-foreground" /> 
                                            : <Briefcase className="h-5 w-5 text-muted-foreground" />
                                        }
                                        <div>
                                            <p className="font-medium">{contact.name}</p>
                                            <p className="text-xs text-muted-foreground capitalize">{contact.type}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                         ) : (
                            <p className="p-4 text-center text-sm text-muted-foreground">No contacts found. Create a new one below.</p>
                         )}
                    </ScrollArea>
                </div>
                <DialogFooter className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-4 border-t">
                     <Button asChild variant="outline" size="lg">
                        <Link href="/customers/add?redirect_to_hisaab=true">
                             <User className="mr-2 h-5 w-5"/> New Customer
                        </Link>
                    </Button>
                    <Button asChild variant="outline" size="lg">
                        <Link href="/karigars/add?redirect_to_hisaab=true">
                            <Briefcase className="mr-2 h-5 w-5"/> New Karigar
                        </Link>
                    </Button>
                </DialogFooter>
            </DialogContent>
       </Dialog>
    );
};


export default function HisaabPage() {
  const appReady = useAppReady();
  const router = useRouter();
  const { toast } = useToast();
  const { hisaabEntries, settings, customers, karigars, isHisaabLoading, isCustomersLoading, isKarigarsLoading, loadHisaab, loadCustomers, loadKarigars, loadGeneratedInvoices, syncHisaabOutstandingBalances } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  
  useEffect(() => {
    if (!appReady) return;
    loadHisaab();
    loadCustomers();
    loadKarigars();
    loadGeneratedInvoices();
    // Sync every page visit — uses getDocs directly so doesn't need store data to be ready
    syncHisaabOutstandingBalances();
  }, [appReady, loadHisaab, loadCustomers, loadKarigars, loadGeneratedInvoices, syncHisaabOutstandingBalances]);
  
  const isLoading = isHisaabLoading || isCustomersLoading || isKarigarsLoading;

  const { accountSummaries, totalReceivable, totalPayable, totalReceivableGold, totalPayableGold } = useMemo(() => {
    if (!Array.isArray(hisaabEntries)) {
      return { accountSummaries: [], totalReceivable: 0, totalPayable: 0, totalReceivableGold: 0, totalPayableGold: 0 };
    }

    const summaryMap: { [entityId: string]: AccountSummary } = {};

    hisaabEntries.forEach(entry => {
      if (!entry.entityId || entry.entityId === 'walk-in') return;
      if (!summaryMap[entry.entityId]) {
        summaryMap[entry.entityId] = {
          entityId: entry.entityId,
          entityName: entry.entityName,
          entityType: entry.entityType,
          cashBalance: 0,
          goldBalance: 0,
        };
      }
      summaryMap[entry.entityId].cashBalance += (entry.cashDebit - entry.cashCredit);
      summaryMap[entry.entityId].goldBalance += (entry.goldDebitGrams - entry.goldCreditGrams);
    });

    const summaries = Object.values(summaryMap)
        .filter(summary => Math.abs(summary.cashBalance) > 0.001 || Math.abs(summary.goldBalance) > 0.001)
        .sort((a,b) => a.entityName.localeCompare(b.entityName));

    const totalReceivable = summaries.reduce((acc, s) => acc + Math.max(0, s.cashBalance), 0);
    const totalPayable = summaries.reduce((acc, s) => acc + Math.abs(Math.min(0, s.cashBalance)), 0);
    const totalReceivableGold = summaries.reduce((acc, s) => acc + Math.max(0, s.goldBalance), 0);
    const totalPayableGold = summaries.reduce((acc, s) => acc + Math.abs(Math.min(0, s.goldBalance)), 0);


    return { accountSummaries: summaries, totalReceivable, totalPayable, totalReceivableGold, totalPayableGold };

  }, [hisaabEntries]);
  
  const filteredSummaries = useMemo(() => {
    if (!searchTerm) {
      return accountSummaries;
    }
    return accountSummaries.filter(summary =>
      summary.entityName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [accountSummaries, searchTerm]);

  const handlePrintReport = async () => {
    if (!settings) {
        toast({ title: "Error", description: "Settings not loaded, cannot generate report.", variant: "destructive" });
        return;
    }

    const iOSWin = openPDFWindowForIOS();
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold").setFontSize(18);
    doc.text(`Hisaab Summary Report`, 14, 22);
    doc.setFontSize(10);
    doc.text(`As of: ${format(new Date(), 'PPpp')}`, 14, 29);

    const tableColumns = ["#", "Name", "Type", "Cash Balance (PKR)", "Gold Balance (g)"];
    const tableRows = filteredSummaries.map((summary, index) => {
        const cashBalanceText = summary.cashBalance > 0 
            ? `${summary.cashBalance.toLocaleString()} (Receivable)` 
            : `${Math.abs(summary.cashBalance).toLocaleString()} (Payable)`;
        
        const goldBalanceText = summary.goldBalance > 0 
            ? `${summary.goldBalance.toLocaleString(undefined, {minimumFractionDigits: 3})} (Receivable)`
            : `${Math.abs(summary.goldBalance).toLocaleString(undefined, {minimumFractionDigits: 3})} (Payable)`;

        return [
            index + 1,
            summary.entityName,
            summary.entityType.charAt(0).toUpperCase() + summary.entityType.slice(1),
            cashBalanceText,
            goldBalanceText
        ];
    });

    doc.autoTable({
        head: [tableColumns],
        body: tableRows,
        startY: 40,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
    });

    await savePDF(doc, `Hisaab-Summary-${format(new Date(), 'yyyy-MM-dd')}.pdf`, iOSWin);
    toast({ title: "Report Downloaded", description: "Hisaab summary PDF has been generated." });
  };


  if (!appReady || (isLoading && hisaabEntries.length === 0)) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Hisaab...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 px-3 md:py-8 md:px-4">
       <AddNewHisaabDialog 
            open={isAddDialogOpen} 
            onOpenChange={setIsAddDialogOpen} 
            customers={customers} 
            karigars={karigars} 
        />
       
       <header className="mb-4 md:mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-primary flex items-center"><BookUser className="mr-2 md:mr-3 h-6 w-6 md:h-8 md:w-8"/>Hisaab</h1>
          <p className="text-sm text-muted-foreground">Outstanding accounts for customers and karigars.</p>
        </div>
        <Button size="sm" onClick={() => setIsAddDialogOpen(true)}>
          <PlusCircle className="mr-2 h-4 w-4"/> Add Entry
        </Button>
      </header>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-green-600/10 border-green-600/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center text-green-700 dark:text-green-500 text-base">
              <ArrowDown className="mr-2 h-4 w-4"/>
              You will Get (Receivable)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-700 dark:text-green-500">PKR {totalReceivable.toLocaleString()}</p>
            {totalReceivableGold > 0 && <p className="text-sm font-semibold text-green-600/90">{totalReceivableGold.toLocaleString(undefined, {minimumFractionDigits: 3})}g Gold</p>}
          </CardContent>
        </Card>
        <Card className="bg-red-500/10 border-red-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center text-destructive text-base">
                <ArrowUp className="mr-2 h-4 w-4"/>
                You will Give (Payable)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">PKR {totalPayable.toLocaleString()}</p>
            {totalPayableGold > 0 && <p className="text-sm font-semibold text-destructive/80">{totalPayableGold.toLocaleString(undefined, {minimumFractionDigits: 3})}g Gold</p>}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 p-3 md:p-4 bg-background/95 backdrop-blur-sm border rounded-lg sticky top-0 z-10 shadow-sm">
            <div className="relative flex-grow w-full">
                <Input
                type="search"
                placeholder="Search by name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            </div>
             <Button variant="outline" onClick={handlePrintReport} className="flex-shrink-0" size="sm">
                <FileText className="mr-2 h-4 w-4"/>
                Export PDF
            </Button>
          </div>

          {filteredSummaries.length > 0 ? (
              <div className="space-y-3">
                  {filteredSummaries.map(summary => (
                      <Link href={`/hisaab/${summary.entityId}?type=${summary.entityType}`} key={summary.entityId}>
                        <Card className="hover:shadow-md transition-shadow cursor-pointer">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-4">
                                    <div className="h-11 w-11 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                        {summary.entityType === 'customer'
                                            ? <User className="h-5 w-5 text-primary"/>
                                            : <Briefcase className="h-5 w-5 text-primary"/>}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="font-semibold truncate">{summary.entityName}</p>
                                            <div className="text-right flex-shrink-0">
                                                {summary.cashBalance > 0 && <p className="font-bold text-green-700 dark:text-green-500 text-sm">PKR {summary.cashBalance.toLocaleString()}</p>}
                                                {summary.cashBalance < 0 && <p className="font-bold text-destructive text-sm">PKR {Math.abs(summary.cashBalance).toLocaleString()}</p>}
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between mt-0.5">
                                            <p className="text-xs text-muted-foreground capitalize">{summary.entityType}</p>
                                            {summary.cashBalance > 0 && <p className="text-xs text-muted-foreground">to receive</p>}
                                            {summary.cashBalance < 0 && <p className="text-xs text-muted-foreground">to pay</p>}
                                        </div>
                                        {summary.goldBalance !== 0 && <p className="text-xs text-muted-foreground mt-0.5">{Math.abs(summary.goldBalance).toLocaleString(undefined, {minimumFractionDigits: 3})} g gold</p>}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                      </Link>
                  ))}
              </div>
          ) : (
              <div className="text-center py-12 bg-card rounded-lg shadow">
                  <BookUser className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-xl font-semibold mb-2">{searchTerm ? 'No Accounts Found' : 'All Settled'}</h3>
                  <p className="text-muted-foreground text-sm">{searchTerm ? 'No accounts match your search.' : 'All accounts are settled. No outstanding balances found.'}</p>
              </div>
          )}
      </div>


    </div>
  );
}
