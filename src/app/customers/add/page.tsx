"use client";

import { CustomerForm } from '@/components/customer/customer-form';
import { useIsStoreHydrated } from '@/lib/store';

export default function AddCustomerPage() {
  const isHydrated = useIsStoreHydrated();

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading form...</p></div>;
  }
  return (
    <div className="container mx-auto p-4">
      <CustomerForm />
    </div>
  );
}
