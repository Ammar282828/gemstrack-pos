"use client";

/**
 * Loading states shaped like the thing that is loading.
 *
 * Thirty-two pages showed the same full-screen centred spinner over an
 * otherwise blank page. A skeleton that matches the page's shape reads as
 * faster than a spinner does, because the layout stops jumping when the data
 * lands — nothing moves, the grey just fills in.
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const Bar: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('h-3 rounded bg-muted animate-pulse', className)} />
);

/** Header plus a few rows — the shape of most list pages. */
export const ListSkeleton: React.FC<{ rows?: number; className?: string }> = ({ rows = 6, className }) => (
  <div className={cn('space-y-4', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    <div className="space-y-2">
      <Bar className="h-7 w-48" />
      <Bar className="h-3 w-32 opacity-60" />
    </div>
    <Card><CardContent className="p-2.5"><Bar className="h-9 w-full opacity-50" /></CardContent></Card>
    <Card>
      <CardContent className="p-0 divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4"
            // Each row fades in slightly later, so the block reads as
            // arriving rather than flashing on all at once.
            style={{ animationDelay: `${i * 60}ms` }}>
            <Bar className="h-9 w-9 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-2 min-w-0">
              <Bar className="w-1/3" />
              <Bar className="w-1/4 opacity-60" />
            </div>
            <Bar className="w-16 flex-shrink-0 opacity-60" />
          </div>
        ))}
      </CardContent>
    </Card>
  </div>
);

/** A row of stat tiles above a couple of panels — dashboards and analytics. */
export const BoardSkeleton: React.FC<{ tiles?: number; panels?: number }> = ({ tiles = 3, panels = 3 }) => (
  <div className="space-y-4" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    <div className="space-y-2">
      <Bar className="h-7 w-40" />
      <Bar className="h-3 w-52 opacity-60" />
    </div>
    <div className={cn('grid gap-4 grid-cols-1', tiles >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-5 space-y-2">
          <Bar className="h-3 w-20 opacity-60" />
          <Bar className="h-7 w-28" />
        </div>
      ))}
    </div>
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
      {Array.from({ length: panels }).map((_, i) => (
        <Card key={i}><CardContent className="p-4 space-y-3">
          <Bar className="h-4 w-28" />
          {[0, 1, 2, 3].map(r => (
            <div key={r} className="space-y-1.5">
              <Bar className="w-2/3" />
              <Bar className="w-1/2 opacity-60" />
            </div>
          ))}
        </CardContent></Card>
      ))}
    </div>
  </div>
);

/** Last resort where a page's shape is genuinely unknown. */
export const PageSkeleton: React.FC = () => (
  <div className="space-y-4" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    <Bar className="h-7 w-44" />
    <Card><CardContent className="p-6 space-y-3">
      {[0, 1, 2, 3, 4].map(i => <Bar key={i} className={i % 2 ? 'w-2/3' : 'w-full'} />)}
    </CardContent></Card>
  </div>
);
