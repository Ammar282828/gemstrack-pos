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

const Bar: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <div style={style} className={cn('h-3 rounded bg-muted animate-pulse motion-reduce:animate-none', className)} />
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

/** A form: label/field pairs in a card, with the action row at the bottom. */
export const FormSkeleton: React.FC<{ fields?: number; columns?: 1 | 2; className?: string }> = ({
  fields = 6, columns = 1, className,
}) => (
  <div className={cn('space-y-4', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    <Bar className="h-7 w-56" />
    <Card>
      <CardContent className="p-5 space-y-5">
        <div className={cn('grid gap-5', columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1')}>
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i} className="space-y-2" style={{ animationDelay: `${i * 60}ms` }}>
              <Bar className="h-3 w-24 opacity-60" />
              <Bar className="h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Bar className="h-10 w-24" />
          <Bar className="h-10 w-32" />
        </div>
      </CardContent>
    </Card>
  </div>
);

/** One record: title, a row of figures, then its sections. */
export const DetailSkeleton: React.FC<{ sections?: number; className?: string }> = ({
  sections = 2, className,
}) => (
  <div className={cn('space-y-4', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    <div className="space-y-2">
      <Bar className="h-7 w-52" />
      <Bar className="h-3 w-36 opacity-60" />
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
          <Bar className="h-3 w-16 opacity-60" />
          <Bar className="h-6 w-24" />
        </div>
      ))}
    </div>
    {Array.from({ length: sections }).map((_, i) => (
      <Card key={i}>
        <CardContent className="p-5 space-y-3">
          <Bar className="h-4 w-32" />
          {[0, 1, 2].map(r => (
            <div key={r} className="flex items-center gap-3">
              <Bar className="h-9 w-9 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2 min-w-0">
                <Bar className="w-1/2" /><Bar className="w-1/3 opacity-60" />
              </div>
              <Bar className="w-20 flex-shrink-0 opacity-60" />
            </div>
          ))}
        </CardContent>
      </Card>
    ))}
  </div>
);

/* ── Reusable shapes (2026-11-03: "skeleton for known state, circle for unknown") ──
   Use these wherever the shape of what is coming is known: a list, a table, a
   grid of thumbnails, a record, a figure, a chart. A spinner is for an action
   in progress, never for these. */

/** List rows without a header: avatar, two lines, a trailing value. Same 72px rows as the real lists. */
export const ListRowsSkeleton: React.FC<{ rows?: number; avatar?: boolean; card?: boolean; className?: string }> = ({
  rows = 5, avatar = true, card = true, className,
}) => {
  const body = (
    <div className="divide-y" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4" style={{ animationDelay: `${i * 60}ms` }}>
          {avatar && <Bar className="h-9 w-9 rounded-full flex-shrink-0" />}
          <div className="flex-1 space-y-2 min-w-0">
            <Bar className="w-1/3" />
            <Bar className="w-1/4 opacity-60" />
          </div>
          <Bar className="w-16 flex-shrink-0 opacity-60" />
        </div>
      ))}
    </div>
  );
  return card ? <Card className={className}><CardContent className="p-0">{body}</CardContent></Card> : <div className={className}>{body}</div>;
};

/** Table rows: a header line and rows of cells. */
export const TableRowsSkeleton: React.FC<{ rows?: number; cols?: number; className?: string }> = ({
  rows = 6, cols = 4, className,
}) => (
  <div className={cn('w-full', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    <div className="flex gap-4 border-b px-4 py-3">
      {Array.from({ length: cols }).map((_, c) => <Bar key={c} className="h-3 flex-1 opacity-60" />)}
    </div>
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex items-center gap-4 border-b px-4 py-3.5" style={{ animationDelay: `${r * 60}ms` }}>
        {Array.from({ length: cols }).map((_, c) => <Bar key={c} className={cn('flex-1', c === 0 ? 'w-1/3' : 'opacity-70')} />)}
      </div>
    ))}
  </div>
);

/** A grid of record cards (products, customers, pieces): image, two lines. */
export const RecordGridSkeleton: React.FC<{ cards?: number; className?: string; image?: boolean }> = ({
  cards = 8, className, image = true,
}) => (
  <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    {Array.from({ length: cards }).map((_, i) => (
      <Card key={i}><CardContent className="space-y-2 p-3" style={{ animationDelay: `${i * 60}ms` }}>
        {image && <Bar className="aspect-square h-auto w-full rounded-lg" />}
        <Bar className="w-3/4" />
        <Bar className="w-1/2 opacity-60" />
      </CardContent></Card>
    ))}
  </div>
);

/** Image thumbnails only (photo pickers, shelves). */
export const ThumbGridSkeleton: React.FC<{ count?: number; className?: string; aspect?: string }> = ({
  count = 8, className, aspect = 'aspect-square',
}) => (
  <div className={cn('grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    {Array.from({ length: count }).map((_, i) => (
      <Bar key={i} className={cn('h-auto w-full rounded-lg', aspect)} />
    ))}
  </div>
);

/** A row of figure tiles (label over a big number). */
export const FigureTilesSkeleton: React.FC<{ tiles?: number; className?: string }> = ({ tiles = 4, className }) => (
  <div className={cn('grid grid-cols-2 gap-3', tiles >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    {Array.from({ length: tiles }).map((_, i) => (
      <div key={i} className="space-y-2 rounded-xl border bg-card p-4">
        <Bar className="h-3 w-16 opacity-60" />
        <Bar className="h-6 w-24" />
      </div>
    ))}
  </div>
);

/** A chart panel: title, then a plot area of fixed height. */
export const ChartSkeleton: React.FC<{ height?: number; className?: string; title?: boolean }> = ({
  height = 240, className, title = true,
}) => (
  <div className={cn('space-y-3', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    {title && <Bar className="h-4 w-32" />}
    <div className="flex items-end gap-2" style={{ height }}>
      {[40, 65, 50, 80, 60, 90, 55, 75].map((h, i) => (
        <Bar key={i} className="h-auto flex-1 rounded-b-none rounded-t-md" style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  </div>
);

/** One record's page: title, figures, then sections — the same as DetailSkeleton, with the page gutter. */
export const RecordPageSkeleton: React.FC<{ sections?: number; className?: string }> = ({ sections = 2, className }) => (
  <DetailSkeleton sections={sections} className={className} />
);

/** Lines of text in place of a paragraph or a short list of options. */
export const LinesSkeleton: React.FC<{ lines?: number; className?: string }> = ({ lines = 3, className }) => (
  <div className={cn('space-y-2', className)} aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading…</span>
    {Array.from({ length: lines }).map((_, i) => <Bar key={i} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />)}
  </div>
);
