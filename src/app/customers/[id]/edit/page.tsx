"use client";

import { CustomerForm } from '@/components/customer/customer-form';
import { ListSkeleton } from '@/components/shared/skeletons';
import { useAppStore } from '@/lib/store';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

export default function EditCustomerPage() {
  const params = useParams();
  const customerId = params.id as string;
  const { customers, isCustomersLoading, loadCustomers } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    loadCustomers();
  }, [loadCustomers]);

  if (!mounted) return null;

  const customer = customers.find(c => c.id === customerId);

  if (isCustomersLoading && !customer) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
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
