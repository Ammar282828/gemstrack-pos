
"use client";

import { useParams } from 'next/navigation';
import { useAppStore, useAppReady } from '@/lib/store';
import { OrderForm } from '@/components/order/order-form';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import React, { useEffect } from 'react';

export default function EditOrderPage() {
  const params = useParams();
  const orderId = params.id as string;
  
  const appReady = useAppReady();
  const { orders, isOrdersLoading, loadOrders } = useAppStore();

  useEffect(() => {
    // Ensure orders are loaded when the component mounts if they aren't already
    if (appReady && orders.length === 0) {
        loadOrders();
    }
  }, [appReady, loadOrders, orders.length]);
  
  const order = orders.find(o => o.id === orderId);

  if (!appReady || (isOrdersLoading && !order)) {
     return (
      <div className="container mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading order data...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Order not found</h2>
        <p className="text-muted-foreground">The order with ID "{orderId}" could not be found.</p>
        <Link href="/orders" passHref>
          <Button variant="link" className="mt-4">Go back to orders list</Button>
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
