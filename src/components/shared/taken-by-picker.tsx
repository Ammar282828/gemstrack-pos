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
    onValueChange={(v) => onChange(v === NONE ? undefined : (v as TakenBy))}
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
