"use client";

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { SalePage } from '@/components/sale/sale-page';
import { FormSkeleton } from '@/components/shared/skeletons';

/** An invoice back in the sale form; saving or cancelling returns to /invoices/<id>. */
export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  return <Suspense fallback={<FormSkeleton fields={8} columns={2} />}><SalePage key={id} editInvoiceId={decodeURIComponent(id)} /></Suspense>;
}
