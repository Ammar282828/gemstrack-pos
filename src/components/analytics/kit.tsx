'use client';

/**
 * The pieces every Analytics page is built from, so a page file is only its sections:
 *
 *   <AnalyticsPage section="profit">
 *     {({ books }) => <> <ChartCard …/> <Figures …/> </>}
 *   </AnalyticsPage>
 *
 * AnalyticsPage is the frame (header with the range picker, the quick-range chips, loading, error, "nothing in this
 * range") and hands the books to its sections, by render prop or by `useBooksContext()`. KpiTile is a headline figure
 * that opens the page answering it; ChartCard is a picture with its one-sentence takeaway; Figures a row of small
 * figures; Explain the folded "how this is worked out". Needs a <Suspense> above it (the range is in the address).
 */

import React, { createContext, useContext } from 'react';
import Link from 'next/link';
import { AlertTriangle, BarChart3, CalendarDays, ChevronRight } from 'lucide-react';
import { PageShell } from '@/components/shared/page-shell';
import { BoardSkeleton } from '@/components/shared/skeletons';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { CardDescription } from '@/components/ui/card';
import { EmptyState, FigureTile } from '@/components/ledger';
import { MonthlyReportButton } from '@/components/reports/monthly-report-button';
import { QUICK_RANGES } from '@/lib/analytics/range-param';
import { toneClasses, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';
import type { Books } from '@/lib/analytics/books';
import { useBooks, type UseBooks } from '@/components/analytics/use-books';

export type AnalyticsSection = 'overview' | 'sales' | 'profit' | 'cash' | 'spending' | 'products' | 'customers' | 'categories' | 'metal';

/** Under each page's title: the question it answers. */
const QUESTIONS: Record<AnalyticsSection, string> = {
  overview: 'How is the shop doing?',
  sales: 'When did the money come in?',
  profit: 'What did we keep?',
  cash: 'What actually moved?',
  spending: 'Where did it go?',
  products: 'What sold?',
  customers: 'Who bought, and how they found us?',
  categories: 'Which kinds of piece?',
  metal: 'How much metal left the shop?',
};

// ── The books, shared with every section ────────────────────────────────────

/** `useBooks()` once the data is in: `books` is never null here. */
export type BooksContextValue = Omit<UseBooks, 'books'> & { books: Books };

const BooksContext = createContext<BooksContextValue | null>(null);

/** The books and the range, inside an AnalyticsPage. */
export function useBooksContext(): BooksContextValue {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error('useBooksContext() must be used inside <AnalyticsPage>.');
  return ctx;
}

/** A link to another Analytics page that keeps the range; plain outside an AnalyticsPage. */
const useRangeHref = () => useContext(BooksContext)?.withRange ?? ((href: string) => href);

// ── The page ────────────────────────────────────────────────────────────────

export function AnalyticsPage({ section, children }: {
  section: AnalyticsSection;
  children: React.ReactNode | ((ctx: BooksContextValue) => React.ReactNode);
}) {
  const state = useBooks();
  const { loading, error, books, hasAnyData, range, rangeKey, setQuick, setCustom } = state;

  // Spending and Cash have something to say about a range with expenses or collections but no sale; Metal about coins.
  const empty = !!books && books.rangeEmpty && !(
    (section === 'cash' && (books.cashIn > 0 || books.cashOut > 0))
    || (section === 'spending' && books.totalExpenses > 0)
    || (section === 'metal' && books.coinSummary.invoices > 0)
  );

  let body: React.ReactNode;
  if (loading || !books) {
    body = <BoardSkeleton tiles={4} panels={2} />;
  } else if (error) {
    body = (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load the data</AlertTitle>
        <CardDescription>
          Could not load analytics data due to a server connection error. Please check your internet connection and try again.
          <p className="mt-2 rounded bg-destructive/10 p-2 font-mono text-xs">Details: {error}</p>
        </CardDescription>
      </Alert>
    );
  } else if (!hasAnyData) {
    body = <div className="rounded-card bg-card"><EmptyState icon={<BarChart3 />} title="No data yet" description="There is no data available to generate analytics yet." /></div>;
  } else if (empty) {
    body = (
      <div className="rounded-card bg-card">
        <EmptyState icon={<CalendarDays />} title="Nothing in this range"
          description="There are no invoices or orders in the selected date range. Adjust the date range to view another period." />
      </div>
    );
  } else {
    const ctx: BooksContextValue = { ...state, books };
    body = (
      <BooksContext.Provider value={ctx}>
        <div className="space-y-[22px] glass-zone">{typeof children === 'function' ? children(ctx) : children}</div>
      </BooksContext.Provider>
    );
  }

  return (
    <PageShell
      subtitle={QUESTIONS[section]}
      action={<>
        <DateRangePicker date={range} onDateChange={setCustom} />
        {/* The month's PDF is the Overview's. */}
        {section === 'overview' && <MonthlyReportButton />}
      </>}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Quick:</span>
        {QUICK_RANGES.map(btn => (
          <Button key={btn.key} variant={rangeKey === btn.key ? 'default' : 'outline'} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setQuick(btn.key)}>
            <span className="hidden sm:inline">{btn.label}</span>
            <span className="sm:hidden">{btn.short}</span>
          </Button>
        ))}
      </div>
      {body}
    </PageShell>
  );
}

// ── A headline figure ───────────────────────────────────────────────────────

export interface Delta {
  /** Signed, in percent. */
  pct: number;
  /** Whether the move is the good one (for an expense, down is better). */
  better: boolean;
}

/**
 * The change from `previous` to `current`, or undefined where there is nothing to compare with (the previous period
 * was empty). `upIsGood` false for a figure where less is better.
 */
export function deltaOf(current: number, previous: number | null | undefined, upIsGood = true): Delta | undefined {
  if (previous == null || !(Math.abs(previous) > 0)) return undefined;
  const pct = (current - previous) / Math.abs(previous) * 100;
  return { pct, better: upIsGood ? pct >= 0 : pct <= 0 };
}

function DeltaPill({ delta, label }: { delta: Delta; label: string }) {
  const flat = Math.abs(delta.pct) < 0.5;
  const t = toneClasses(flat ? 'quiet' : delta.better ? 'settled' : 'late');
  const shown = Math.abs(delta.pct) >= 1000 ? '999+' : Math.abs(delta.pct) < 10 ? Math.abs(delta.pct).toFixed(1) : Math.round(Math.abs(delta.pct)).toString();
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-ios-foot font-medium tabular-nums', t.tint, t.ink)}>
      {/* The arrow says the direction, the tone says whether it is good; neither is the colour alone. */}
      <span aria-hidden>{flat ? '▬' : delta.pct > 0 ? '▲' : '▼'}</span>
      <span className="truncate">{flat ? 'No change' : `${shown}%`} vs {label}</span>
    </span>
  );
}

/** The line under a number: points normalised to the box, 2px, in the house series colour. */
function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - lo) / span) * 28}`).join(' ');
  return (
    <svg aria-hidden viewBox="0 0 100 32" preserveAspectRatio="none" className="mt-2 h-8 w-full overflow-visible">
      <polyline points={pts} fill="none" stroke="var(--ana-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface KpiTileProps {
  label: string;
  /** Already formatted (`pkrLac`). */
  value: React.ReactNode;
  /** Against the period before; none when it was empty (use `deltaOf`). */
  delta?: Delta;
  /** What the delta is against; the books' own label ("last month") by default. */
  deltaLabel?: string;
  /** One quiet line: "12% margin", "in PKR 3 lac · out PKR 1 lac". */
  sub?: React.ReactNode;
  /** The page this opens; the range goes with it. */
  href: string;
  /** The period's values, drawn as a 2px line under the number. */
  spark?: number[];
  /** Colours the number (owed for money still to come). */
  tone?: Tone;
}

/** A headline figure. The whole tile is the link to the page that answers it. */
export function KpiTile({ label, value, delta, deltaLabel, sub, href, spark, tone }: KpiTileProps) {
  const ctx = useContext(BooksContext);
  const withRange = useRangeHref();
  const against = deltaLabel ?? ctx?.previousLabel ?? 'the period before';
  return (
    <Link
      href={withRange(href)}
      className="glass-card block min-w-0 rounded-card bg-card p-4 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:active:scale-[.985]"
    >
      <div className="flex items-center justify-between gap-2 text-ios-sub text-muted-foreground">
        <span className="truncate">{label}</span>
        <ChevronRight aria-hidden className="h-4 w-4 flex-shrink-0 opacity-60" />
      </div>
      <div className={cn('mt-1 break-words font-serif text-ios-title2 font-semibold tabular-nums', tone ? toneClasses(tone).ink : 'text-foreground')}>{value}</div>
      {delta && <div className="mt-1.5"><DeltaPill delta={delta} label={against} /></div>}
      {sub ? <div className="mt-1 text-ios-foot text-muted-foreground">{sub}</div> : null}
      {spark && spark.length > 1 ? <MiniSpark values={spark} /> : null}
    </Link>
  );
}

// ── A picture with its sentence ─────────────────────────────────────────────

export interface ChartCardProps {
  title: string;
  /** One plain sentence stating the takeaway in numbers: "Best day Tue 4 Nov · PKR 3.2 lac". */
  takeaway?: React.ReactNode;
  /**
   * Makes the whole card a link to the page that goes deeper (the range goes with it). The chart is then a picture: it
   * answers no hover, so use it where the chart has no controls (the Overview). Controls in `action` stay clickable.
   */
  href?: string;
  /** The room the chart needs, in px, so the card does not jump while it loads. */
  height?: number;
  /** Controls in the header (a Segmented): reachable even when `href` makes the card a link. */
  action?: React.ReactNode;
  id?: string;
  className?: string;
  children: React.ReactNode;
}

export function ChartCard({ title, takeaway, href, height, action, id, className, children }: ChartCardProps) {
  const withRange = useRangeHref();
  return (
    <section id={id} className={cn('glass-card relative min-w-0 scroll-mt-20 rounded-card bg-card p-4', className)}>
      {href && (
        <Link
          href={withRange(href)}
          aria-label={`${title}: see more`}
          className="absolute inset-0 z-10 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-ios-headline font-semibold text-foreground">{title}</h2>
        {action ? <div className="relative z-20 flex-shrink-0">{action}</div>
          : href ? <span aria-hidden className="flex-shrink-0 text-ios-sub text-muted-foreground">See more ›</span> : null}
      </div>
      {takeaway ? <p className="mt-0.5 text-ios-sub text-muted-foreground">{takeaway}</p> : null}
      <div className="mt-3" style={height ? { minHeight: height } : undefined}>{children}</div>
    </section>
  );
}

// ── Small figures, a section, the fold ──────────────────────────────────────

export interface FigureItem {
  label: string;
  /** A number is shown as PKR in lac/crore; give a string for a count or a unit. */
  value: React.ReactNode;
  detail?: React.ReactNode;
  tint?: Tone;
}

/** A row of small figures (the ledger's FigureTile): two across on a phone, up to four from a laptop. */
export function Figures({ items, columns = 4 }: { items: FigureItem[]; columns?: 2 | 3 | 4 }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', columns === 3 && 'lg:grid-cols-3', columns === 4 && 'lg:grid-cols-4')}>
      {items.map(i => <FigureTile key={i.label} label={i.label} value={i.value} detail={i.detail} tint={i.tint} />)}
    </div>
  );
}

/** A titled block of a deep page (a table, a second chart); `id` for a `#anchor` link. */
export function Section({ title, action, id, children }: { title: string; action?: React.ReactNode; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-20 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ios-headline font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "How this is worked out": folded, small and muted, never a paragraph above the numbers. */
export function Explain({ children, title = 'How this is worked out' }: { children: React.ReactNode; title?: string }) {
  return (
    <details className="group rounded-card bg-card px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-ios-sub font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="h-4 w-4 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="mt-2 space-y-2 text-ios-foot text-muted-foreground">{children}</div>
    </details>
  );
}
