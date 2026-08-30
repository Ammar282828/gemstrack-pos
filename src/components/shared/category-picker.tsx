"use client";

/**
 * Category as a dropdown: open it, see every category, pick one.
 *
 * This briefly used the SearchablePicker, on the theory that twenty entries is
 * past the point where scanning beats typing. That was wrong for this field.
 * The categories are a short fixed list the shop knows by heart, the field is
 * touched on every product and every order line, and the picker's search box
 * autofocuses — which on a tablet throws a keyboard over the list you came to
 * read. Scanning a familiar twenty beats typing three letters. Lists that
 * genuinely need search — karigars, banks, 51 ring sizes — keep the
 * SearchablePicker.
 *
 * The list is passed in rather than read from a store, because callers differ:
 * order and cart lines use the fixed catalogue, product forms use the store's,
 * which can carry custom categories.
 */

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface PickableCategory { id: string; title: string }

/** Radix rejects an empty item value, so "no category" travels as a sentinel. */
const NONE = '__none__';

export const CategoryPicker: React.FC<{
  categories: readonly PickableCategory[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Offers a row that clears the field; the label describes what empty means. */
  clearLabel?: string;
  className?: string;
  'aria-label'?: string;
}> = ({ categories, value, onChange, placeholder = 'Select category', clearLabel, className, 'aria-label': ariaLabel }) => (
  <Select value={value || ''} onValueChange={v => onChange(v === NONE ? '' : v)}>
    <SelectTrigger className={cn('w-full', className)} aria-label={ariaLabel || 'Category'}>
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent>
      {clearLabel && <SelectItem value={NONE}>{clearLabel}</SelectItem>}
      {categories.map(c => (
        <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
      ))}
    </SelectContent>
  </Select>
);
