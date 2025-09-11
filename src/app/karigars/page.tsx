

"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAppStore, Karigar } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, PlusCircle, Edit3, Trash2, Briefcase, Phone, StickyNote, Loader2, Eye, BookUser } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';

const KarigarActions: React.FC<{ karigar: Karigar; onDelete: (id: string) => Promise<void>; isCard?: boolean }> = ({ karigar, onDelete, isCard }) => (
    <div className={isCard ? 'flex gap-2' : 'flex justify-end space-x-2'}>
      <Button asChild size="sm" variant="outline" className="flex-1">
        <Link href={`/hisaab/${karigar.id}?type=karigar`}>
          <BookUser className="w-4 h-4 mr-2" /> Ledger
        </Link>
      </Button>
      <Button asChild size="sm" variant={isCard ? 'default' : 'outline'} className="flex-1">
        <Link href={`/karigars/${karigar.id}/edit`}>
          <Edit3 className="w-4 h-4 mr-2" /> Edit
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline" className="flex-1">
        <Link href={`/karigars/${karigar.id}`}>
          <Eye className="w-4 h-4 mr-2" /> View
        </Link>
      </Button>
    </div>
);


const KarigarRow: React.FC<{ karigar: Karigar; onDelete: (id: string) => Promise<void> }> = ({ karigar, onDelete }) => {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/karigars/${karigar.id}`} className="font-medium text-primary hover:underline">
          {karigar.name}
        </Link>
      </TableCell>
      <TableCell>{karigar.contact || '-'}</TableCell>
      <TableCell className="truncate max-w-xs">{karigar.notes || '-'}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end space-x-2">
            <Button asChild size="sm" variant="ghost">
                <Link href={`/hisaab/${karigar.id}?type=karigar`}>
                    <BookUser className="w-4 h-4" />
                </Link>
            </Button>
             <Button asChild size="sm" variant="ghost">
                <Link href={`/karigars/${karigar.id}`}>
                    <Eye className="w-4 h-4" />
                </Link>
            </Button>
             <Button asChild size="sm" variant="ghost">
                <Link href={`/karigars/${karigar.id}/edit`}>
                    <Edit3 className="w-4 h-4" />
                </Link>
            </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

const KarigarCard: React.FC<{ karigar: Karigar; onDelete: (id: string) => Promise<void> }> = ({ karigar, onDelete }) => (
    <Card className="mb-4">
        <CardHeader>
            <Link href={`/karigars/${karigar.id}`} className="font-bold text-primary hover:underline">
                <CardTitle className="flex items-center gap-2">
                    <Briefcase className="w-5 h-5"/>
                    {karigar.name}
                </CardTitle>
            </Link>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
             {karigar.contact && <div className="flex items-center gap-2"><Phone className="w-4 h-4"/><span>{karigar.contact}</span></div>}
             {karigar.notes && <div className="flex items-start gap-2"><StickyNote className="w-4 h-4 mt-1 flex-shrink-0"/><span>{karigar.notes}</span></div>}
        </CardContent>
        <CardFooter className="p-2 border-t bg-muted/30">
            <KarigarActions karigar={karigar} onDelete={onDelete} isCard />
        </CardFooter>
    </Card>
);


export default function KarigarsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  
  const appReady = useAppReady();
  const { karigars, deleteKarigarAction, isKarigarsLoading, loadKarigars } = useAppStore(state => ({
    karigars: state.karigars,
    deleteKarigarAction: state.deleteKarigar,
    isKarigarsLoading: state.isKarigarsLoading,
    loadKarigars: state.loadKarigars,
  }));
  const { toast } = useToast();

  useEffect(() => {
    if (appReady) {
      loadKarigars();
    }
  }, [appReady, loadKarigars]);


  const handleDeleteKarigar = async (id: string) => {
    await deleteKarigarAction(id);
    toast({ title: "Karigar Deleted", description: `Karigar has been deleted.` });
  };

  const filteredKarigars = useMemo(() => {
    if (!appReady) return [];
    return karigars.filter(karigar =>
      karigar.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (karigar.contact && karigar.contact.includes(searchTerm))
    );
  }, [karigars, searchTerm, appReady]);

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading karigars...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-primary flex items-center"><Briefcase className="w-8 h-8 mr-3"/>Manage Karigars</h1>
          <p className="text-muted-foreground">Oversee your artisans and their accounts.</p>
        </div>
        <Link href="/karigars/add" passHref>
          <Button size="lg">
            <PlusCircle className="w-5 h-5 mr-2" />
            Add New Karigar
          </Button>
        </Link>
      </header>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="relative flex-grow w-full">
            <Input
              type="search"
              placeholder="Search by name or contact..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      {isKarigarsLoading ? (
         <div className="text-center py-12">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Refreshing karigar list...</p>
         </div>
      ) : filteredKarigars.length > 0 ? (
        <>
        {/* Mobile View: Cards */}
        <div className="md:hidden">
            {filteredKarigars.map((karigar) => (
                <KarigarCard key={karigar.id} karigar={karigar} onDelete={handleDeleteKarigar} />
            ))}
        </div>
        {/* Desktop View: Table */}
        <Card className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><Briefcase className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Name</TableHead>
                <TableHead><Phone className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Contact</TableHead>
                <TableHead><StickyNote className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredKarigars.map((karigar) => (
                <KarigarRow key={karigar.id} karigar={karigar} onDelete={handleDeleteKarigar} />
              ))}
            </TableBody>
          </Table>
        </Card>
        </>
      ) : (
        <div className="text-center py-12 bg-card rounded-lg shadow">
          <Briefcase className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Karigars Found</h3>
          <p className="text-muted-foreground">
            {searchTerm ? "Try adjusting your search term." : "Add some karigars to get started!"}
          </p>
        </div>
      )}
    </div>
  );
}
