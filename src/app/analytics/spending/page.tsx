"use client";

// Analytics → spending: the page is components/analytics/pages/spending.tsx (the range is in the query).
import { Suspense } from 'react';
import { SpendingPage } from '@/components/analytics/pages/spending';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl"><ListSkeleton /></div>}>
      <SpendingPage />
    </Suspense>
  );
}
