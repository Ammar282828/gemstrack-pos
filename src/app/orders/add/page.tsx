"use client";

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OrderForm } from '@/components/order/order-form';
import { Loader2 } from 'lucide-react';

function AddOrderInner() {
  // ?fromCart=1 carries the current cart into this form, so "create an order"
  // from the cart reuses this one order-creation path instead of a second.
  const seedFromCart = useSearchParams().get('fromCart') === '1';
  return <OrderForm seedFromCart={seedFromCart} />;
}

export default function AddOrderPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto py-8 px-4 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />Loading order form…
      </div>
    }>
      <AddOrderInner />
    </Suspense>
  );
}
