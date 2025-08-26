

"use client";

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppStore, Karigar, useIsStoreHydrated, HisaabEntry } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Edit3, Trash2, ArrowLeft, User, Phone, StickyNote, BookUser, ArrowDown, ArrowUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const DetailItem: React.FC<{ label: string; value: string | undefined; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex items-start py-2">
    {icon && <span className="mr-3 mt-1 text-muted-foreground">{icon}</span>}
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground whitespace-pre-wrap">{value || '-'}</p>
    </div>
  </div>
);

export default function KarigarDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const karigarId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const karigar = useAppStore(state => state.karigars.find(k => k.id === karigarId));
  const allHisaabEntries = useAppStore(state => state.hisaabEntries);
  const deleteKarigarAction = useAppStore(state => state.deleteKarigar);

  const { karigarHisaab, balances } = React.useMemo(() => {
    const filteredEntries = allHisaabEntries
      .filter(entry => entry.entityId === karigarId)
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

    let cashBalance = 0;
    let goldBalance = 0;
    
    const entriesWithBalances = filteredEntries.map(entry => {
        cashBalance += (entry.cashDebit - entry.cashCredit);
        goldBalance += (entry.goldDebitGrams - entry.goldCreditGrams);
        return { ...entry, runningGoldBalance: goldBalance };
    });

    return {
        karigarHisaab: entriesWithBalances.reverse(), // Show most recent first
        balances: { finalCashBalance: cashBalance, finalGoldBalance: goldBalance }
    };

  }, [allHisaabEntries, karigarId]);


  const handleDeleteKarigar = () => {
    if (!karigar) return;
    deleteKarigarAction(karigar.id);
    toast({ title: "Karigar Deleted", description: `Karigar ${karigar.name} has been deleted.` });
    router.push('/karigars');
  };

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading karigar details...</p></div>;
  }

  if (!karigar) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Karigar not found</h2>
        <Link href="/karigars" passHref>
          <Button variant="link" className="mt-4">Go back to karigars list</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-6">
      <Button variant="outline" onClick={() => router.push('/karigars')} className="mb-0">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Karigars List
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-2xl">{karigar.name}</CardTitle>
                <User className="w-8 h-8 text-primary" />
              </div>
              <CardDescription>Karigar ID: {karigar.id}</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailItem label="Contact" value={karigar.contact} icon={<Phone className="w-4 h-4" />} />
              <Separator className="my-1" />
              <DetailItem label="Notes" value={karigar.notes} icon={<StickyNote className="w-4 h-4" />} />
            </CardContent>
            <CardFooter className="flex flex-col space-y-2">
                <Button asChild className="w-full">
                    <Link href={`/hisaab/${karigar.id}?type=karigar`}>
                        <BookUser className="mr-2 h-4 w-4" /> View Full Hisaab
                    </Link>
                </Button>
              <div className="flex space-x-2 w-full">
                <Button asChild variant="outline" className="flex-1">
                    <Link href={`/karigars/${karigarId}/edit`}>
                    <Edit3 className="mr-2 h-4 w-4" /> Edit
                    </Link>
                </Button>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="flex-1"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete the karigar {karigar.name}.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteKarigar}>Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardFooter>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Gold Account Summary</CardTitle>
              <CardDescription>
                Overview of gold transactions with {karigar.name}. 
                A positive balance means the karigar owes you gold. A negative balance means you owe them gold.
              </CardDescription>
            </CardHeader>
            <CardContent>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-red-500/10 text-destructive">
                      <p className="text-sm font-semibold">Receivable (Karigar owes you)</p>
                      <p className="text-xl font-bold">{Math.max(0, balances.finalGoldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })} g</p>
                  </div>
                  <div className="p-4 rounded-lg bg-green-500/10 text-green-700 dark:text-green-400">
                      <p className="text-sm font-semibold">Payable (You owe Karigar)</p>
                      <p className="text-xl font-bold">{Math.abs(Math.min(0, balances.finalGoldBalance)).toLocaleString(undefined, { minimumFractionDigits: 3 })} g</p>
                  </div>
              </div>
               <Separator className="my-4"/>
               <div className="p-4 rounded-lg bg-muted/50">
                  <h4 className="font-semibold">Cash Balance Summary</h4>
                  {balances.finalCashBalance >= 0 ? (
                      <p>You need to pay them <strong className="text-destructive">PKR {balances.finalCashBalance.toLocaleString()}</strong>.</p>
                  ) : (
                      <p>They need to pay you <strong className="text-green-600">PKR {Math.abs(balances.finalCashBalance).toLocaleString()}</strong>.</p>
                  )}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Gold Transaction History</CardTitle>
              <CardDescription>Detailed log of gold transactions only.</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[400px]">
                    {karigarHisaab.filter(e => e.goldDebitGrams > 0 || e.goldCreditGrams > 0).length > 0 ? (
                    <Table>
                        <TableHeader>
                        <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Gold</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                        {karigarHisaab.filter(e => e.goldDebitGrams > 0 || e.goldCreditGrams > 0).map(entry => (
                            <TableRow key={entry.id}>
                            <TableCell>{format(parseISO(entry.date), 'dd-MMM-yy')}</TableCell>
                            <TableCell>{entry.description}</TableCell>
                            <TableCell className={cn("text-right font-medium", entry.goldDebitGrams > 0 ? 'text-destructive' : 'text-green-600')}>
                                {entry.goldDebitGrams > 0 ? 
                                    <span><ArrowUp className="inline h-3 w-3 mr-1"/>{entry.goldDebitGrams.toLocaleString(undefined, {minimumFractionDigits: 3})} g</span> :
                                    <span><ArrowDown className="inline h-3 w-3 mr-1"/>{entry.goldCreditGrams.toLocaleString(undefined, {minimumFractionDigits: 3})} g</span>
                                }
                            </TableCell>
                            <TableCell className="text-right">{entry.runningGoldBalance.toLocaleString(undefined, {minimumFractionDigits: 3})} g</TableCell>
                            </TableRow>
                        ))}
                        </TableBody>
                    </Table>
                    ) : (
                    <p className="text-muted-foreground text-center py-4">No gold transactions recorded yet for this karigar.</p>
                    )}
                </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
