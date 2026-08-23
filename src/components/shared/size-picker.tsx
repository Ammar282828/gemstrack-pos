"use client";

/**
 * Category-aware size input, in controlled (value/onChange) form so it can be
 * dropped into a plain dialog as well as a react-hook-form field.
 *
 * The scale comes from SIZE_SCALES, so a category that gains a ring part later
 * picks it up here with no change to the callers. Multi-part scales compose
 * into the single "Ring: 10 · Bracelet: 2.4" string the rest of the app stores.
 */

import React from 'react';
import {
  sizeScaleFor, isMultiPartScale, composeMultiSize, parseMultiSize,
  legacyPartKeyFor, categoryNeedsSize,
} from '@/lib/store';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SearchablePicker } from '@/components/shared/searchable-picker';
import { cn } from '@/lib/utils';

/**
 * One size field. A grid rather than a dropdown: ring sizes run 0–25 in half
 * steps, which is 51 rows to scroll past in a native Select, and a Ring +
 * Bracelet set renders two of those. Typing filters, and an off-scale value
 * can still be entered.
 */
const ScaleField: React.FC<{
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}> = ({ label, options, value, onChange }) => (
  <div>
    <Label className="text-xs text-muted-foreground">{label}</Label>
    <SearchablePicker
      value={value}
      onChange={onChange}
      options={options.map(o => ({ value: o, label: o }))}
      placeholder="Select"
      searchPlaceholder="Type a size…"
      layout="grid"
      allowCustom
      clearLabel="No size"
      aria-label={label}
      triggerClassName="mt-1"
    />
  </div>
);

export const SizePicker: React.FC<{
  categoryId?: string;
  value: string;
  onChange: (v: string) => void;
  /** Render a free-text box even for categories with no scale. */
  alwaysShow?: boolean;
  className?: string;
}> = ({ categoryId, value, onChange, alwaysShow, className }) => {
  const scale = sizeScaleFor(categoryId);

  if (!categoryNeedsSize(categoryId)) {
    if (!alwaysShow) return null;
    return (
      <div className={className}>
        <Label className="text-xs">Size</Label>
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Optional"  aria-label="Size"/>
      </div>
    );
  }

  if (isMultiPartScale(scale)) {
    const parsed = parseMultiSize(value, legacyPartKeyFor(scale));
    const setPart = (key: string, v: string) => onChange(composeMultiSize({ ...parsed, [key]: v }));
    return (
      <div className={className}>
        <Label className="text-xs">{scale.label}</Label>
        <div className={cn('grid gap-3 mt-1', scale.parts.length > 1 && 'sm:grid-cols-2')}>
          {scale.parts.map(part => (
            <ScaleField key={part.key} label={part.label} options={part.options}
              value={parsed[part.key] || ''} onChange={v => setPart(part.key, v)} />
          ))}
        </div>
        <p className="text-2xs text-muted-foreground mt-1">Leave either blank if not applicable.</p>
      </div>
    );
  }

  if (scale && 'options' in scale) {
    return (
      <div className={className}>
        <ScaleField label={scale.label} options={scale.options} value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className={className}>
      <Label className="text-xs">Size</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Optional"  aria-label="Size"/>
    </div>
  );
};
