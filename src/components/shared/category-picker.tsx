"use client";

/**
 * Category as a field. Fourteen entries is past the point where scanning a
 * dropdown beats typing the first three letters, and this is the field you
 * touch on every single product and order line.
 *
 * The list is passed in rather than read from a store, because callers differ:
 * order and cart lines use the fixed catalogue, product forms use the store's,
 * which can carry custom categories.
 */

import React from 'react';
import { SearchablePicker } from '@/components/shared/searchable-picker';

export interface PickableCategory { id: string; title: string }

export const CategoryPicker: React.FC<{
  categories: readonly PickableCategory[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearLabel?: string;
  className?: string;
  'aria-label'?: string;
}> = ({ categories, value, onChange, placeholder = 'Select category', clearLabel, className, 'aria-label': ariaLabel }) => (
  <SearchablePicker
    value={value}
    onChange={onChange}
    options={categories.map(c => ({ value: c.id, label: c.title }))}
    placeholder={placeholder}
    searchPlaceholder="Type a category…"
    clearLabel={clearLabel}
    triggerClassName={className}
    aria-label={ariaLabel || 'Category'}
  />
);
