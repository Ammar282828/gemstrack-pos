'use client';

import { useCallback, useRef } from 'react';

/** A fresh name for one money intent. */
const fresh = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * One request id per money intent (a payment, an advance, a sale, an order), the same for every retry
 * or double tap of that submit, so the shared write (lib/writes) records it once.
 *
 *   const intent = useIntentId();
 *   await recordPayment(…, intent.id());   // every click of this submit sends the same id
 *   intent.renew();                        // after it saved, or when the dialog closes: the next intent is new
 *
 * `id()` is stable until `renew()`; nothing here re-renders.
 */
export function useIntentId() {
  const ref = useRef<string | null>(null);
  const id = useCallback(() => (ref.current ??= fresh()), []);
  const renew = useCallback(() => { ref.current = null; }, []);
  return { id, renew };
}
