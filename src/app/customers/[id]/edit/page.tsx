"use client";

import { useParams } from 'next/navigation';
import { useAppStore, Customer, useIsStoreHydrated } from '@/lib/store';
import { CustomerForm } from '@/components/customer/customer-form';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function EditCustomerPage() {
  const params = useParams();
  const customerId = params.id as string;
  
  const isHydrated = useIsStoreHydrated();
  const customer = useAppStore(state => state.customers.find(c => c.id === customerId));

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading customer data...</p></div>;
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
