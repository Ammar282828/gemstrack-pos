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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const NONE = '__none__';
const CUSTOM = '__custom__';

/** One dropdown plus an "Other…" escape hatch for a value off the scale. */
const ScaleSelect: React.FC<{
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}> = ({ label, options, value, onChange }) => {
  const isCustom = !!value && !options.includes(value);
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={isCustom ? CUSTOM : value}
        onValueChange={v => onChange(v === CUSTOM ? value : v === NONE ? '' : v)}
      >
        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— None —</SelectItem>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          <SelectItem value={CUSTOM}>Other…</SelectItem>
        </SelectContent>
      </Select>
      {isCustom && (
        <Input className="mt-2" placeholder={`Custom ${label.toLowerCase()}`}
          value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
};

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
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Optional" />
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
            <ScaleSelect key={part.key} label={part.label} options={part.options}
              value={parsed[part.key] || ''} onChange={v => setPart(part.key, v)} />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">Leave either blank if not applicable.</p>
      </div>
    );
  }

  if (scale && 'options' in scale) {
    return (
      <div className={className}>
        <ScaleSelect label={scale.label} options={scale.options} value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <div className={className}>
      <Label className="text-xs">Size</Label>
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder="Optional" />
    </div>
  );
};
