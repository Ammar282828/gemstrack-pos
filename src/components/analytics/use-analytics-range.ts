'use client';

/**
 * The date range every Analytics tab shares, read from and written to the address
 * (lib/analytics/range-param.ts). Needs a <Suspense> above it (useSearchParams).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { DateRange } from 'react-day-picker';
import { readRange, rangeQuery } from '@/lib/analytics/range-param';

export function useAnalyticsRange() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // A rolling range ends today: re-read when the day turns on a page left open (a phone keeps the
  // tab) — on coming back to it, and once a minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const check = () => setNow(prev => (new Date().toDateString() === prev.toDateString() ? prev : new Date()));
    const id = setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, []);

  const query = params.toString();
  const { key, range } = useMemo(() => readRange(new URLSearchParams(query), now), [query, now]);

  const go = useCallback((q: string) => router.replace(`${pathname}${q}`, { scroll: false }), [router, pathname]);
  const setQuick = useCallback((k: string) => go(rangeQuery(k)), [go]);
  const setCustom = useCallback((r: DateRange | undefined) => (r?.from ? go(rangeQuery('custom', { from: r.from, to: r.to })) : go(rangeQuery('all-time'))), [go]);
  /** A link to another Analytics page that keeps this range. */
  const withRange = useCallback((href: string) => `${href}${query ? `?${query}` : ''}`, [query]);

  return { key, range: range as DateRange | undefined, setQuick, setCustom, withRange };
}
