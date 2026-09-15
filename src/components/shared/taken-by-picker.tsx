"use client";

/**
 * Who took the order, or wrote the invoice.
 *
 * One control shared by both, so the two records answer the same question the same way
 * and a filter can count across them. The list is fixed (TAKEN_BY) rather than free text:
 * this is counted, and "Ammar" typed three ways is three people to a filter.
 *
 * Deliberately not derived from the signed-in account. Five people work one counter and
 * whoever is standing at the screen is usually not whose session it is — reading it off
 * the login would quietly credit every sale to whoever logged in that morning.
 */

import React from 'react';
import { TAKEN_BY, type TakenBy } from '@/lib/store';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Select needs a non-empty value, and "" is how the form says nobody. */
const NONE = '__none__';

/*
 * ON IGNORING "": Radix Select keeps a hidden native <select> so that a wrapping form
 * sees changes, and when the CONTROLLED value changes it pushes the new value into that
 * native element and dispatches a change event to bubble it. If the native select cannot
 * represent the value at that instant, its value reads "" and Radix reports
 * onValueChange("") -- for a change nobody made. On an edit form, where form.reset()
 * sets this field after mount, that fired every time and cleared "Ammar" to nothing a
 * few renders after it had been loaded. The order page then showed the field as never
 * set, and the same thing emptied "How they found us" beside it.
 *
 * "" is never a real selection here: nobody clears this through anything but the
 * "Not set" row, whose value is NONE. So "" is dropped on the floor. Every Select in the
 * app that uses a sentinel for "none" carries the same one-line guard.
 */

export const TakenByPicker: React.FC<{
  value?: TakenBy | '';
  onChange: (v: TakenBy | undefined) => void;
  /** Include an explicit "anyone" row — for filters, not for entry. */
  allowAny?: boolean;
  anyLabel?: string;
  className?: string;
  'aria-label'?: string;
}> = ({ value, onChange, allowAny, anyLabel = 'Anyone', className, 'aria-label': ariaLabel }) => (
  <Select
    value={value || NONE}
    onValueChange={(v) => { if (v === '') return; onChange(v === NONE ? undefined : (v as TakenBy)); }}
  >
    <SelectTrigger className={className} aria-label={ariaLabel ?? 'Taken by'}>
      <SelectValue placeholder={allowAny ? anyLabel : 'Not set'} />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={NONE}>{allowAny ? anyLabel : '— Not set —'}</SelectItem>
      {TAKEN_BY.map((n) => (
        <SelectItem key={n} value={n}>{n}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);
