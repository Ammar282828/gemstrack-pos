"use client";

// Analytics → profit: the page is components/analytics/pages/profit.tsx (the range is in the query).
import { Suspense } from 'react';
import { ProfitPage } from '@/components/analytics/pages/profit';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl"><ListSkeleton /></div>}>
      <ProfitPage />
    </Suspense>
  );
}
