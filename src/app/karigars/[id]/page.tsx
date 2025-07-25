

"use client";

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppStore, Karigar, useIsStoreHydrated } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Edit3, Trash2, ArrowLeft, User, Phone, StickyNote, PlusCircle, BookUser } from 'lucide-react';
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
  // const hisaabs = useAppStore(state => state.karigarHisaabs.filter(h => h.karigarId === karigarId)); // TODO: Implement Hisaab
  const deleteKarigarAction = useAppStore(state => state.deleteKarigar);

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

  // TODO: Calculate gold balance based on hisaabs

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
                        <BookUser className="mr-2 h-4 w-4" /> View Hisaab
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
              <CardDescription>Overview of gold transactions with {karigar.name}.</CardDescription>
            </CardHeader>
            <CardContent>
              {/* TODO: Display gold balance summary here */}
              <p className="text-muted-foreground text-center py-4">Hisaab (transaction) details will appear here.</p>
              <p className="text-muted-foreground text-center">Total Gold Given: -- grams</p>
              <p className="text-muted-foreground text-center">Total Gold Received (Adjusted): -- grams</p>
              <p className="font-semibold text-center mt-2">Current Balance: -- grams</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Transaction History (Hisaabs)</CardTitle>
              <CardDescription>Detailed log of gold transactions.</CardDescription>
            </CardHeader>
            <CardContent>
              {/* TODO: Display table of hisaabs here */}
              <p className="text-muted-foreground text-center py-4">No hisaabs recorded yet for this karigar.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
