

"use client";

import React, { useMemo, useState } from 'react';
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
import { cn } from '@/lib/utils';


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
  const { hisaabEntries, settings, customers, karigars, isHisaabLoading, isCustomersLoading, isKarigarsLoading } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  
  const isLoading = isHisaabLoading || isCustomersLoading || isKarigarsLoading;

  const { accountSummaries, totalReceivable, totalPayable, totalReceivableGold, totalPayableGold } = useMemo(() => {
    if (!Array.isArray(hisaabEntries)) {
      return { accountSummaries: [], totalReceivable: 0, totalPayable: 0, totalReceivableGold: 0, totalPayableGold: 0 };
    }

    const summaryMap: { [entityId: string]: AccountSummary } = {};

    hisaabEntries.forEach(entry => {
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

  const handlePrintReport = () => {
    if (!settings) {
        toast({ title: "Error", description: "Settings not loaded, cannot generate report.", variant: "destructive" });
        return;
    }

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

    doc.save(`Hisaab-Summary-${format(new Date(), 'yyyy-MM-dd')}.pdf`);
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
    <div className="container mx-auto py-8 px-4 relative pb-24">
       <AddNewHisaabDialog 
            open={isAddDialogOpen} 
            onOpenChange={setIsAddDialogOpen} 
            customers={customers} 
            karigars={karigars} 
        />
       
       <header className="mb-8">
        <h1 className="text-3xl font-bold text-primary flex items-center"><BookUser className="mr-3 h-8 w-8"/>Hisaab / Ledger</h1>
        <p className="text-muted-foreground">Summary of all outstanding accounts for customers and karigars.</p>
      </header>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card className="bg-red-500/10 border-red-500/20">
          <CardHeader>
            <CardTitle className="flex items-center text-destructive">
              <ArrowDown className="mr-2 h-5 w-5"/>
              You will Get (Receivable)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-destructive">PKR {totalReceivable.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            {totalReceivableGold > 0 && <p className="text-lg font-semibold text-destructive/90">{totalReceivableGold.toLocaleString(undefined, {minimumFractionDigits: 3})}g Gold</p>}
          </CardContent>
        </Card>
        <Card className="bg-green-600/10 border-green-600/20">
          <CardHeader>
            <CardTitle className="flex items-center text-green-700 dark:text-green-500">
                <ArrowUp className="mr-2 h-5 w-5"/>
                You will Give (Payable)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-green-700 dark:text-green-500">PKR {totalPayable.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
            {totalPayableGold > 0 && <p className="text-lg font-semibold text-green-600/90 dark:text-green-400/90">{totalPayableGold.toLocaleString(undefined, {minimumFractionDigits: 3})}g Gold</p>}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 p-4 border rounded-lg bg-card sticky top-0 z-10">
            <div className="relative flex-grow w-full">
                <Input
                type="search"
                placeholder="Search by name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            </div>
             <Button variant="outline" onClick={handlePrintReport} className="h-11 flex-shrink-0">
                <FileText className="mr-2 h-4 w-4"/>
                Export PDF
            </Button>
          </div>

          {filteredSummaries.length > 0 ? (
              <div className="space-y-2">
                  {filteredSummaries.map(summary => (
                      <Link href={`/hisaab/${summary.entityId}?type=${summary.entityType}`} key={summary.entityId}>
                        <Card className="shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                            <CardContent className="p-4 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center font-bold text-primary flex-shrink-0">
                                        {summary.entityName.substring(0, 2).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-base text-primary">{summary.entityName}</h3>
                                        <p className="text-xs text-muted-foreground capitalize">{summary.entityType}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    {summary.cashBalance > 0 && <p className="font-semibold text-destructive">PKR {summary.cashBalance.toLocaleString()}</p>}
                                    {summary.cashBalance < 0 && <p className="font-semibold text-green-600">PKR {Math.abs(summary.cashBalance).toLocaleString()}</p>}
                                    {summary.goldBalance > 0 && <p className="text-xs text-destructive/80">{summary.goldBalance.toLocaleString(undefined, {minimumFractionDigits: 3})} g</p>}
                                    {summary.goldBalance < 0 && <p className="text-xs text-green-600/80">{Math.abs(summary.goldBalance).toLocaleString(undefined, {minimumFractionDigits: 3})} g</p>}
                                </div>
                            </CardContent>
                        </Card>
                      </Link>
                  ))}
              </div>
          ) : (
              <Card>
                <CardContent className="text-center py-10">
                    <p className="text-muted-foreground">{searchTerm ? 'No accounts match your search.' : 'All accounts are settled. No outstanding balances found.'}</p>
                </CardContent>
              </Card>
          )}
      </div>

       <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-20">
         <Button 
            size="lg" 
            className="rounded-full shadow-lg h-14 text-lg"
            onClick={() => setIsAddDialogOpen(true)}
        >
            <PlusCircle className="mr-3 h-6 w-6"/> Add New
         </Button>
       </div>
    </div>
  );
}
