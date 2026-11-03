'use client';

import { useEffect, useRef } from 'react';
import { visibleInterval } from '@/lib/visible-interval';

/**
 * `setInterval` for a component that stops while the page is hidden and catches up when it returns
 * (lib/visible-interval.ts). `fn` may change every render; the timer is not restarted for it.
 * `ms` null (or `enabled` false) is off.
 */
export function useVisibleInterval(fn: () => void, ms: number | null, opts: { enabled?: boolean; catchUp?: boolean } = {}) {
  const ref = useRef(fn);
  ref.current = fn;
  const { enabled = true, catchUp = true } = opts;
  useEffect(() => {
    if (!enabled || ms === null) return;
    return visibleInterval(() => ref.current(), ms, { catchUp });
  }, [ms, enabled, catchUp]);
}
