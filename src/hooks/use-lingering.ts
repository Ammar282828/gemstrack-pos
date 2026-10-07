import { useRef } from 'react';

/**
 * The last value that was there, while it isn't any more — for a dialog that is open while `value` is
 * set (`open={!!value}`) and shows it. Closing clears the value at once, but the dialog takes ~150ms
 * to leave; read straight, its words went blank, its title lost its number and a payment's balance
 * fell to 0 as it faded (2026-10-07). Read through this, it leaves as it was.
 *
 * Only for what the dialog shows: act on the real value.
 */
export function useLingering<T>(value: T | null | undefined): T | null | undefined {
  const last = useRef(value);
  if (value !== null && value !== undefined) last.current = value;
  return value ?? last.current;
}
