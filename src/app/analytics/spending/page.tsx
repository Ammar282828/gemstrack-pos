"use client";

// Analytics → one section per address; the range is in the query (components/analytics).
import { Suspense } from 'react';
import { AnalyticsPage } from '@/components/analytics/kit';
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Page() {
  return (
    <Suspense fallback={<div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl"><ListSkeleton /></div>}>
      <AnalyticsPage section="spending">
        {/* TODO: this page's sections (docs: the Analytics redesign spec). */}
        <div className="rounded-card bg-card p-4 text-ios-sub text-muted-foreground">This page is being built.</div>
      </AnalyticsPage>
    </Suspense>
  );
}
