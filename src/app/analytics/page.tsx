"use client";

// Analytics → one section per address; the range is in the query (components/analytics).
import { Suspense } from 'react';
import { AnalyticsView } from '@/components/analytics/analytics-view';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl"><ListSkeleton /></div>}>
      <AnalyticsView section="overview" />
    </Suspense>
  );
}
