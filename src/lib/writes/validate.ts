/**
 * What a money write refuses before it touches anything: a figure that is not a number, is negative, or is
 * absurdly large (a typo or a hostile body: 1e308 would sit in the books for ever), and a date that is not
 * a date. One copy for the web and the apps; the app's write route answers an InputError with a 400.
 */

/** Ten thousand million rupees: far past any real sale, well inside what a double holds exactly. */
export const MAX_MONEY = 1e10;

export class InputError extends Error {
  readonly name = 'InputError';
}

/** A finite figure from 0 to MAX_MONEY (`positive`: above 0). Returns it as a number. */
export function checkMoney(v: unknown, what: string, opts: { positive?: boolean } = {}): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_MONEY || (opts.positive && !(n > 0))) {
    throw new InputError(`${what} must be a figure ${opts.positive ? 'above 0' : 'of 0 or more'} and at most ${MAX_MONEY.toLocaleString('en-US')}.`);
  }
  return n;
}

/** An optional figure: left out stays undefined; given, it must pass checkMoney. */
export function checkMoneyIfGiven(v: unknown, what: string): number | undefined {
  return v === undefined || v === null || v === '' ? undefined : checkMoney(v, what);
}

const ISO = /^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

/** An ISO date or date-time (what the books keep dates as). Returns it as sent. */
export function checkIsoDate(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length > 40 || !ISO.test(v.trim()) || !Number.isFinite(Date.parse(v.trim()))) {
    throw new InputError(`${what} must be a date such as 2026-10-20.`);
  }
  return v.trim();
}

export const checkIsoDateIfGiven = (v: unknown, what: string): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : checkIsoDate(v, what);
