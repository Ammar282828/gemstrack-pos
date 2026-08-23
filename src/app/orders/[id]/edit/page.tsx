'use client';

import { OrderForm } from '@/components/order/order-form';
import { ListSkeleton } from '@/components/shared/skeletons';
import { useAppStore } from '@/lib/store';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

export default function EditOrderPage() {
  const params = useParams();
  const orderId = params.id as string;
  const { orders, isOrdersLoading, loadOrders } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    loadOrders();
  }, [loadOrders]);

  if (!mounted) return null;

  const order = orders.find(o => o.id === orderId);

  if (isOrdersLoading && !order) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Order not found</h2>
        <p className="text-muted-foreground">The order with ID "{orderId}" could not be found.</p>
        <Link href="/orders" passHref>
          <Button variant="link" className="mt-4">Go back to orders</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <OrderForm order={order} />
    </div>
  );
}
