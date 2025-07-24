
"use client";

import { useParams } from 'next/navigation';
import { useAppStore, Customer } from '@/lib/store';
import { CustomerForm } from '@/components/customer/customer-form';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import React, { useEffect } from 'react';

export default function EditCustomerPage() {
  const params = useParams();
  const customerId = params.id as string;
  
  const { customers, isCustomersLoading, loadCustomers } = useAppStore();

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);
  
  const customer = customers.find(c => c.id === customerId);

  if (isCustomersLoading && !customer) {
    return (
      <div className="container mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading customer data...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Customer not found</h2>
        <p className="text-muted-foreground">The customer with ID "{customerId}" could not be found.</p>
        <Link href="/customers" passHref>
          <Button variant="link" className="mt-4">Go back to customers</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <CustomerForm customer={customer} />
    </div>
  );
}
