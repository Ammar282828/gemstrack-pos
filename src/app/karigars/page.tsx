
"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useAppStore, Karigar, useIsStoreHydrated } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, PlusCircle, Edit3, Trash2, Briefcase, Phone, StickyNote } from 'lucide-react';
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

const KarigarRow: React.FC<{ karigar: Karigar; onDelete: (id: string) => void }> = ({ karigar, onDelete }) => {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/karigars/${karigar.id}`} className="font-medium text-primary hover:underline">
          {karigar.name}
        </Link>
        <div className="text-xs text-muted-foreground">ID: {karigar.id}</div>
      </TableCell>
      <TableCell>{karigar.contact || '-'}</TableCell>
      <TableCell className="hidden md:table-cell truncate max-w-xs">{karigar.notes || '-'}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end space-x-2">
          <Button asChild size="sm" variant="outline" className="whitespace-nowrap">
            <Link href={`/karigars/${karigar.id}/edit`} passHref legacyBehavior>
              <a>
                <Edit3 className="w-4 h-4 mr-1 md:mr-2" />
                <span className="hidden md:inline">Edit</span>
              </a>
            </Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive"><Trash2 className="w-4 h-4" /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the karigar "{karigar.name}". 
                  Any hisaabs associated with this karigar will also be affected (future: define behavior).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(karigar.id)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
};


export default function KarigarsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  
  const isHydrated = useIsStoreHydrated();
  const karigars = useAppStore(state => state.karigars);
  const deleteKarigarAction = useAppStore(state => state.deleteKarigar);
  const { toast } = useToast();

  const handleDeleteKarigar = (id: string) => {
    deleteKarigarAction(id);
    toast({ title: "Karigar Deleted", description: `Karigar has been deleted.` });
  };

  const filteredKarigars = useMemo(() => {
    if (!isHydrated) return [];
    return karigars.filter(karigar =>
      karigar.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (karigar.contact && karigar.contact.includes(searchTerm))
    );
  }, [karigars, searchTerm, isHydrated]);

  if (!isHydrated) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-center text-muted-foreground">Loading karigars...</p>
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

      {filteredKarigars.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><Briefcase className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Name</TableHead>
                <TableHead><Phone className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Contact</TableHead>
                <TableHead className="hidden md:table-cell"><StickyNote className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Notes</TableHead>
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
