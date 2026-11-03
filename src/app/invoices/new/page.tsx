"use client";

import { Suspense } from 'react';
import { SalePage } from '@/components/sale/sale-page';
import { FormSkeleton } from '@/components/shared/skeletons';

/** A new sale (`?draft=` continues one from Drafts, `?scan=bill` opens Read a written bill). */
export default function NewInvoicePage() {
  return <Suspense fallback={<FormSkeleton fields={8} columns={2} />}><SalePage /></Suspense>;
}
