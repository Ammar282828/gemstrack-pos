"use client";

import { notFound } from 'next/navigation';
import { OrdersHub } from '@/components/order/orders-hub';
import { STORE_SHOPIFY_SECTION } from '@/lib/store-config';

/** House of Mina's Shopify orders (owner, 2026-11-09): the Orders hub, for the orders from the online store. */
export default function ShopifyPage() {
  if (!STORE_SHOPIFY_SECTION) notFound();
  return <OrdersHub mode="shopify" />;
}
