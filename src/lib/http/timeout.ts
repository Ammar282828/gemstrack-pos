/**
 * An abort signal that fires after `ms`, joined with the caller's own signal when one is given
 * (so a cancelled request still cancels, and a hung one still ends).
 */
export function timeoutSignal(ms: number, signal?: AbortSignal | null): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}
