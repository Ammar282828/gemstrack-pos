"use client";

// Analytics → Sales; the range is in the query (components/analytics).
import { Suspense } from 'react';
import { SalesPage } from '@/components/analytics/pages/sales';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl"><ListSkeleton /></div>}>
      <SalesPage />
    </Suspense>
  );
}
