"use client";

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { SalePage } from '@/components/sale/sale-page';

/** An invoice back in the sale form; saving or cancelling returns to /invoices/<id>. */
export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <Suspense><SalePage key={id} editInvoiceId={decodeURIComponent(id)} /></Suspense>;
}
