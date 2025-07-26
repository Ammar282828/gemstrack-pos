
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAppStore, Customer, useAppReady } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, PlusCircle, Edit3, Trash2, User, Phone, Mail, MapPin, Users, Loader2, Eye, BookUser } from 'lucide-react';
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

const CustomerActions: React.FC<{ customer: Customer; onDelete: (id: string) => Promise<void>; isCard?: boolean }> = ({ customer, onDelete, isCard }) => {
  return (
      <div className={isCard ? 'flex gap-2' : 'flex justify-end space-x-2'}>
           <Button asChild size="sm" variant="outline" className="flex-1">
            <Link href={`/hisaab/${customer.id}?type=customer`}>
                <BookUser className="w-4 h-4 mr-2" /> Ledger
            </Link>
            </Button>
          <Button asChild size="sm" variant={isCard ? 'default' : 'outline'} className="flex-1">
            <Link href={`/customers/${customer.id}/edit`}>
              <Edit3 className="w-4 h-4 mr-2" /> Edit
            </Link>
          </Button>
           <Button asChild size="sm" variant="outline" className="flex-1">
            <Link href={`/customers/${customer.id}`}>
                <Eye className="w-4 h-4 mr-2" /> View
            </Link>
            </Button>
        </div>
  )
}

const CustomerRow: React.FC<{ customer: Customer; onDelete: (id: string) => Promise<void> }> = ({ customer, onDelete }) => {
  return (
    <TableRow>
      <TableCell>
        <Link href={`/customers/${customer.id}`} className="font-medium text-primary hover:underline">
          {customer.name}
        </Link>
      </TableCell>
      <TableCell>{customer.phone || '-'}</TableCell>
      <TableCell>{customer.email || '-'}</TableCell>
      <TableCell>{customer.address || '-'}</TableCell>
      <TableCell className="text-right">
        <CustomerActions customer={customer} onDelete={onDelete} />
      </TableCell>
    </TableRow>
  );
};

const CustomerCard: React.FC<{ customer: Customer; onDelete: (id: string) => Promise<void> }> = ({ customer, onDelete }) => (
    <Card className="mb-4">
        <CardHeader>
             <Link href={`/customers/${customer.id}`} className="font-bold text-primary hover:underline">
                <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5"/>
                    {customer.name}
                </CardTitle>
            </Link>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
            {customer.phone && <div className="flex items-center gap-2"><Phone className="w-4 h-4"/><span>{customer.phone}</span></div>}
            {customer.email && <div className="flex items-center gap-2"><Mail className="w-4 h-4"/><span>{customer.email}</span></div>}
            {customer.address && <div className="flex items-start gap-2"><MapPin className="w-4 h-4 mt-1 flex-shrink-0"/><span>{customer.address}</span></div>}
        </CardContent>
        <CardFooter className="p-2 border-t bg-muted/30">
            <CustomerActions customer={customer} onDelete={onDelete} isCard />
        </CardFooter>
    </Card>
);


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

  if (!appReady) {
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

      {isCustomersLoading ? (
         <div className="text-center py-12">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Refreshing customer list...</p>
         </div>
      ) : filteredCustomers.length > 0 ? (
        <>
            {/* Mobile View: Cards */}
            <div className="md:hidden">
                {filteredCustomers.map((customer) => (
                    <CustomerCard key={customer.id} customer={customer} onDelete={handleDeleteCustomer} />
                ))}
            </div>

            {/* Desktop View: Table */}
            <Card className="hidden md:block">
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead><User className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Name</TableHead>
                    <TableHead><Phone className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Phone</TableHead>
                    <TableHead><Mail className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Email</TableHead>
                    <TableHead><MapPin className="inline-block mr-1 h-4 w-4 text-muted-foreground"/>Address</TableHead>
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
        </>
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
