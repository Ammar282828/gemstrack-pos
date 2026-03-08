

"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppStore, Expense } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Edit3, Trash2, ArrowLeft, User, Phone, StickyNote, PlusCircle, Banknote } from 'lucide-react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ExpenseForm } from '@/components/expense/expense-form';

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
  const expenses = useAppStore(state => state.expenses);
  const deleteKarigarAction = useAppStore(state => state.deleteKarigar);
  const { loadExpenses } = useAppStore();
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);

  useEffect(() => {
    loadExpenses();
  }, [loadExpenses]);

  const karigarExpenses = React.useMemo(() => {
    return expenses
      .filter(e => e.karigarId === karigarId)
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [expenses, karigarId]);

  const totalCashPaid = karigarExpenses.reduce((sum, e) => sum + e.amount, 0);


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

      {/* Record Payment Dialog */}
      <Dialog open={isPaymentFormOpen} onOpenChange={setIsPaymentFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center"><Banknote className="mr-2 h-5 w-5"/>Record Payment to {karigar?.name}</DialogTitle>
          </DialogHeader>
          <ExpenseForm
            lockedKarigarId={karigarId}
            onSubmitSuccess={() => setIsPaymentFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

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
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-xl">Cash Payment History</CardTitle>
                <CardDescription>All cash payments made to {karigar.name}, recorded as expenses.</CardDescription>
              </div>
              <Button size="sm" onClick={() => setIsPaymentFormOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" /> Record Payment
              </Button>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 mb-4">
                <span className="font-semibold">Total Paid to {karigar.name}</span>
                <span className="text-xl font-bold text-destructive">PKR {totalCashPaid.toLocaleString()}</span>
              </div>
              <ScrollArea className="h-[300px]">
                {karigarExpenses.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Amount (PKR)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {karigarExpenses.map(expense => (
                        <TableRow key={expense.id}>
                          <TableCell className="whitespace-nowrap">{format(parseISO(expense.date), 'dd MMM yy')}</TableCell>
                          <TableCell>{expense.description}</TableCell>
                          <TableCell className="text-muted-foreground">{expense.category}</TableCell>
                          <TableCell className="text-right font-medium">{expense.amount.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground text-center py-6">No payments recorded yet. Use "Record Payment" to add one, or link existing expenses to this karigar from the Expenses page.</p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
