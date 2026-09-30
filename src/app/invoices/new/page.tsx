"use client";

import { Suspense } from 'react';
import { SalePage } from '@/components/sale/sale-page';

/** A new sale (`?draft=` continues one from Drafts, `?scan=bill` opens Read a written bill). */
export default function NewInvoicePage() {
  return <Suspense><SalePage /></Suspense>;
}
