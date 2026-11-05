"use client";

// Analytics → Overview; the range is in the query (components/analytics).
import { Suspense } from 'react';
import { OverviewPage } from '@/components/analytics/pages/overview';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl"><ListSkeleton /></div>}>
      <OverviewPage />
    </Suspense>
  );
}
