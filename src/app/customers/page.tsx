
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAppStore, Customer, useAppReady } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, PlusCircle, Edit3, Trash2, User, Phone, Mail, MapPin, Users, Loader2 } from 'lucide-react';
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

const CustomerRow: React.FC<{ customer: Customer; onDelete: (id: string) => Promise<void> }> = ({ customer, onDelete }) => {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/customers/${customer.id}`} className="font-medium text-primary hover:underline">
          {customer.name}
        </Link>
        <div className="text-xs text-muted-foreground md:hidden">{customer.phone || customer.email}</div>
      </TableCell>
      <TableCell className="hidden md:table-cell">{customer.phone || '-'}</TableCell>
      <TableCell className="hidden md:table-cell">{customer.email || '-'}</TableCell>
      <TableCell className="hidden lg:table-cell">{customer.address || '-'}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end space-x-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/customers/${customer.id}/edit`}>
              <Edit3 className="w-4 h-4" />
              <span className="sr-only">Edit {customer.name}</span>
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
                  This action cannot be undone. This will permanently delete the customer "{customer.name}".
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={async () => await onDelete(customer.id)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
};


export default function CustomersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  
  const appReady = useAppReady();
  const customers = useAppStore(state => state.customers);
  const deleteCustomerAction = useAppStore(state => state.deleteCustomer);
  const isCustomersLoading = useAppStore(state => state.isCustomersLoading);
  const { toast } = useToast();

  const handleDeleteCustomer = async (id: string) => {
    await deleteCustomerAction(id);
    toast({ title: "Customer Deleted", description: `Customer has been deleted.` });
  };

  const filteredCustomers = useMemo(() => {
    if (!appReady) return [];
    return customers.filter(customer =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (customer.phone && customer.phone.includes(searchTerm)) ||
      (customer.email && customer.email.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [customers, searchTerm, appReady]);

  if (!appReady && isCustomersLoading) { // Show loader if app isn't fully ready but this specific data is loading
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading customers...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary">Manage Customers</h1>
          <p className="text-muted-foreground">Keep track of your valuable clients.</p>
        </div>
        <Link href="/customers/add" passHref>
          <Button size="lg">
            <PlusCircle className="w-5 h-5 mr-2" />
            Add New Customer
          </Button>
        </Link>
      </header>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="relative flex-grow w-full">
            <Input
              type="search"
              placeholder="Search by name, phone, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      {isCustomersLoading && appReady ? (
         <div className="text-center py-12">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Refreshing customer list...</p>
         </div>
      ) : filteredCustomers.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><User className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Name</TableHead>
                <TableHead className="hidden md:table-cell"><Phone className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Phone</TableHead>
                <TableHead className="hidden md:table-cell"><Mail className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Email</TableHead>
                <TableHead className="hidden lg:table-cell"><MapPin className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Address</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCustomers.map((customer) => (
                <CustomerRow key={customer.id} customer={customer} onDelete={handleDeleteCustomer} />
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <div className="text-center py-12 bg-card rounded-lg shadow">
          <Users className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No Customers Found</h3>
          <p className="text-muted-foreground">
            {searchTerm ? "Try adjusting your search term." : "Add some customers to get started!"}
          </p>
        </div>
      )}
    </div>
  );
}
