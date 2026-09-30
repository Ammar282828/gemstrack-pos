"use client";

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OrderForm } from '@/components/order/order-form';
import { Loader2 } from 'lucide-react';
import { FormSkeleton } from '@/components/shared/skeletons';

function AddOrderInner() {
  // ?fromCart=1 carries the current cart into this form, so "create an order"
  // from the cart reuses this one order-creation path instead of a second.
  const params = useSearchParams();
  const seedFromCart = params.get('fromCart') === '1';
  // ?draft=… continues an unfinished order from Drafts (and keeps the one being typed across a reload).
  // ?scan=parchi opens Scan a parchi at once (New sale's link).
  return <OrderForm seedFromCart={seedFromCart} draftId={params.get('draft')} openScanner={params.get('scan') === 'parchi'} />;
}

export default function AddOrderPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <FormSkeleton fields={8} columns={2} />
      </div>
    }>
      <AddOrderInner />
    </Suspense>
  );
}
