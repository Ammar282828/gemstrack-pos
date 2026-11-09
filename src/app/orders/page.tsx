"use client";

import { OrdersHub } from '@/components/order/orders-hub';

/** The Orders hub; the screen itself is components/order/orders-hub.tsx (shared with /shopify). */
export default function OrdersPage() {
  return <OrdersHub mode="orders" />;
}
