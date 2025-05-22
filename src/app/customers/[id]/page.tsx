"use client";

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAppStore, Customer, Product, selectAllProductsWithCosts } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Edit3, Trash2, ArrowLeft, User, Phone, Mail, MapPin, Package } from 'lucide-react';
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
import { useIsStoreHydrated } from '@/lib/store';

type ProductWithCosts = ReturnType<typeof selectAllProductsWithCosts>[0];

const DetailItem: React.FC<{ label: string; value: string | undefined; icon?: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="flex items-start py-2">
    {icon && <span className="mr-3 mt-1 text-muted-foreground">{icon}</span>}
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value || '-'}</p>
    </div>
  </div>
);

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const customerId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const customer = useAppStore(state => state.customers.find(c => c.id === customerId));
  const assignedProducts = useAppStore(state => 
    selectAllProductsWithCosts(state).filter(p => p.assignedCustomerId === customerId)
  );
  const deleteCustomerAction = useAppStore(state => state.deleteCustomer);
  
  const handleDeleteCustomer = () => {
    deleteCustomerAction(customerId);
    toast({ title: "Customer Deleted", description: `Customer ${customer?.name} has been deleted.` });
    router.push('/customers');
  };

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading customer details...</p></div>;
  }

  if (!customer) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Customer not found</h2>
        <Link href="/customers" passHref>
          <Button variant="link" className="mt-4">Go back to customers</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <Button variant="outline" onClick={() => router.back()} className="mb-6">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to List
      </Button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="text-2xl">{customer.name}</CardTitle>
                <User className="w-8 h-8 text-primary" />
              </div>
              <CardDescription>Customer ID: {customer.id}</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailItem label="Phone" value={customer.phone} icon={<Phone className="w-4 h-4" />} />
              <Separator className="my-1" />
              <DetailItem label="Email" value={customer.email} icon={<Mail className="w-4 h-4" />} />
              <Separator className="my-1" />
              <DetailItem label="Address" value={customer.address} icon={<MapPin className="w-4 h-4" />} />
            </CardContent>
            <CardFooter className="flex space-x-2">
              <Link href={`/customers/${customerId}/edit`} passHref>
                <Button variant="outline" className="w-full"><Edit3 className="mr-2 h-4 w-4" /> Edit</Button>
              </Link>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full"><Trash2 className="mr-2 h-4 w-4" /> Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete the customer and unassign them from any products.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteCustomer}>Delete</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Assigned Products</CardTitle>
              <CardDescription>Products currently assigned to {customer.name}.</CardDescription>
            </CardHeader>
            <CardContent>
              {assignedProducts.length > 0 ? (
                <ul className="space-y-3">
                  {assignedProducts.map((product: ProductWithCosts) => (
                    <li key={product.sku} className="p-3 border rounded-md hover:bg-muted/50 transition-colors">
                      <Link href={`/products/${product.sku}`} className="flex justify-between items-center">
                        <div>
                          <p className="font-medium text-primary">{product.name}</p>
                          <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
                        </div>
                        <Package className="w-5 h-5 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-center py-4">No products assigned to this customer.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
