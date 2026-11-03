'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Warm a page the moment a hand moves toward it.
 *
 * A `<Link>` already prefetches its page when it scrolls into view. A row that opens its record with
 * `router.push` in an onClick (a table row, a card) has no link to prefetch, so the tap waited for the page's
 * code. Spread the result on that row: hovering (a mouse), the finger touching down (a phone: the page
 * loads while the finger lifts, ~100 ms earlier than the click) or keyboard focus prefetches `href`.
 * `router.prefetch` de-duplicates and does nothing in development.
 *
 *   <TableRow {...usePrefetchIntent(`/invoices/${id}`)} onClick={…}>
 */
export function usePrefetchIntent(href: string | null | undefined) {
  const router = useRouter();
  return useMemo(() => {
    if (!href) return {};
    const warm = () => { try { router.prefetch(href); } catch { /* a prefetch is only ever a hint */ } };
    return { onPointerEnter: warm, onPointerDown: warm, onFocus: warm };
  }, [router, href]);
}
