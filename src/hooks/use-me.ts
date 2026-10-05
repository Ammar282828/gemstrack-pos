'use client';

/**
 * The signed-in person's counter name (lib/people.ts), for defaults: "Taken by" on new work,
 * and the lists filtered to them. Undefined when nobody is signed in or the account has no name.
 */

import { useCallback, useState } from 'react';
import { useAuth } from '@/components/auth/google-auth-gate';
import { personFor } from '@/lib/people';
import type { TakenBy } from '@/lib/store';

export function useMe(): TakenBy | undefined {
  const { user } = useAuth();
  return personFor(user?.email) as TakenBy | undefined;
}

const ANYONE = '__anyone__';

/**
 * A list's "Taken by" filter. It starts on the signed-in person (the Workshop), or on Anyone with
 * `startOnMe: false` — Orders and Invoices, the owner, 2026-10-05: "remove the default filter for
 * every account when looking at orders and invoice page"; there the signed-in person's own rows are
 * highlighted in place instead (`mineRowClass`). Whatever is picked after — someone, or Anyone —
 * holds for the rest of the visit (sessionStorage, per list), so opening an order and coming back
 * doesn't snap the list back.
 */
export function useMineFilter(list: string, opts: { startOnAnyone?: boolean; startOnMe?: boolean } = {}): [TakenBy | undefined, (v: TakenBy | undefined) => void] {
  const me = useMe();
  const key = `gemstrack:taken-by-filter:${list}`;
  const [value, setValue] = useState<TakenBy | undefined>(() => {
    // A link that asks for everything (a karigar's whole bench) starts on Anyone, this once —
    // nothing is kept, so the list's next plain visit starts as it always does.
    if (opts.startOnAnyone) return undefined;
    try {
      const kept = typeof window !== 'undefined' ? window.sessionStorage.getItem(key) : null;
      if (kept) return kept === ANYONE ? undefined : (kept as TakenBy);
    } catch { /* storage refused: start as the list starts */ }
    return opts.startOnMe === false ? undefined : me;
  });
  const set = useCallback((v: TakenBy | undefined) => {
    setValue(v);
    try { window.sessionStorage.setItem(key, v ?? ANYONE); } catch { /* the filter still changes */ }
  }, [key]);
  return [value, set];
}
