"use client";

// Analytics → cash: the page is components/analytics/pages/cash.tsx (the range is in the query).
import { Suspense } from 'react';
import { CashPage } from '@/components/analytics/pages/cash';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl"><ListSkeleton /></div>}>
      <CashPage />
    </Suspense>
  );
}
