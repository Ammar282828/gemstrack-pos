"use client";

/**
 * A number field that formats itself while you type.
 *
 * `<input type="number">` cannot show separators — the browser rejects any
 * value containing a comma — so this is a text input with its own parsing.
 * It also fixes the things a raw number input gets wrong in this app:
 *
 *   · 15000 reads as 15,000 the moment the fifth digit lands
 *   · leading zeros collapse, so 0500 becomes 500 and 007 becomes 7
 *   · a cleared field is empty, not 0 — those mean different things when the
 *     value is a price
 *   · pasting "PKR 1,25,000" or "1 250.50" gives 125000 / 1250.5
 *   · the caret stays where it was, counted in digits rather than characters,
 *     so inserting a separator does not jump it to the end
 */

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Everything that is not a digit, a dot, or a leading minus. */
function digitsOnly(raw: string): string {
  let s = raw.replace(/[^\d.-]/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '');
  // Only the first dot can be a decimal point; "1.2.3" is a typo, not a number.
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }
  return (negative ? '-' : '') + s;
}

/** Group the integer part; leave whatever the user is typing after the dot. */
function format(clean: string, maxDecimals: number): string {
  if (clean === '' || clean === '-') return clean;
  const negative = clean.startsWith('-');
  const body = negative ? clean.slice(1) : clean;
  const [intRaw = '', decRaw] = body.split('.');
  // Strip leading zeros but keep a single one before a decimal point.
  const int = intRaw.replace(/^0+(?=\d)/, '') || '0';
  const grouped = Number(int).toLocaleString('en-US');
  const dec = decRaw === undefined ? undefined : decRaw.slice(0, maxDecimals);
  const out = dec === undefined ? grouped : `${grouped}.${dec}`;
  return (negative ? '-' : '') + out;
}

const countDigits = (s: string, upto: number) =>
  (s.slice(0, upto).match(/[\d.]/g) || []).length;

export interface AmountInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | string | null | undefined;
  /** Receives a number, or undefined when the field is cleared. */
  onValueChange?: (v: number | undefined) => void;  // `emptyValue` when cleared
  /** Kept so the component can drop straight into react-hook-form fields. */
  onChange?: (e: { target: { value: number | undefined; name?: string } }) => void;
  maxDecimals?: number;
  allowNegative?: boolean;
  /**
   * What a cleared field reports. Defaults to `''`, which is exactly what
   * `<input type="number">` gives — so this drops into existing react-hook-form
   * fields with `z.coerce.number()` without changing how they validate.
   * Pass `undefined` where blank genuinely has to differ from zero.
   */
  emptyValue?: '' | undefined;
}

export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ value, onValueChange, onChange, maxDecimals = 2, allowNegative = false,
     emptyValue = '', className, name, onBlur, ...rest }, ref) => {
    const inner = React.useRef<HTMLInputElement | null>(null);
    const setRef = (el: HTMLInputElement | null) => {
      inner.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    // While typing, the field owns its own text — reformatting a half-typed
    // "1." or "1.50" from the numeric prop would fight the user.
    const [draft, setDraft] = React.useState<string | null>(null);
    const pendingCaret = React.useRef<number | null>(null);

    const fromProp = value === null || value === undefined || value === ''
      ? ''
      : format(digitsOnly(String(value)), maxDecimals);
    const shown = draft ?? fromProp;

    const emit = (n: number | undefined) => {
      const out = (n === undefined ? emptyValue : n) as number | undefined;
      onValueChange?.(out);
      onChange?.({ target: { value: out, name } });
    };

    const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      const caret = el.selectionStart ?? el.value.length;
      const digitsBefore = countDigits(el.value, caret);

      let clean = digitsOnly(el.value);
      if (!allowNegative) clean = clean.replace(/-/g, '');
      const text = format(clean, maxDecimals);
      setDraft(text);

      // Derived from the formatted text, not the raw input: the display clamps
      // to maxDecimals, and storing more precision than is shown means the
      // saved figure quietly disagrees with the one on screen.
      const canonical = text.replace(/,/g, '');
      const numeric = canonical === '' || canonical === '-' || canonical === '.'
        ? undefined : Number(canonical);
      emit(numeric === undefined || Number.isNaN(numeric) ? undefined : numeric);

      // Remember which digit the caret was sitting after. It is restored in a
      // layout effect rather than here: React re-renders with the new text and
      // would put the caret back at the end, undoing anything set during the
      // change handler.
      pendingCaret.current = digitsBefore;
    };

    React.useLayoutEffect(() => {
      const want = pendingCaret.current;
      const node = inner.current;
      pendingCaret.current = null;
      if (want === null || !node) return;
      // Walk to the position holding the same digit after regrouping.
      let pos = 0, seen = 0;
      while (pos < shown.length && seen < want) {
        if (/[\d.]/.test(shown[pos])) seen++;
        pos++;
      }
      try { node.setSelectionRange(pos, pos); } catch { /* some types disallow it */ }
    });

    return (
      <Input
        {...rest}
        name={name}
        ref={setRef}
        type="text"
        inputMode={maxDecimals > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={shown}
        onChange={handle}
        onBlur={e => {
          // Hand the canonical form back on the way out, so "1." settles to "1".
          setDraft(null);
          onBlur?.(e);
        }}
        className={cn('tabular-nums', className)}
      />
    );
  },
);
AmountInput.displayName = 'AmountInput';
