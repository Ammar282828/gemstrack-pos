"use client";

/**
 * A picker for lists too long to scan.
 *
 * The native Select is fine for five options and miserable for fifty — ring
 * sizes run 0 to 25 in half steps, which is 51 entries in one scrolling
 * dropdown, and a Ring + Bracelet set renders two of them. This adds a search
 * box, and a grid layout for short values where seeing the whole range at once
 * beats scrolling a column.
 *
 * Deliberately not a Select: Radix's Select has no filtering, and bolting one
 * on fights its keyboard handling.
 */

import React, { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PickerOption {
  value: string;
  label: string;
  /** Shown under the label in list layout. */
  hint?: string;
  /** Optional heading this option sits under. */
  group?: string;
}

export const SearchablePicker: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: PickerOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  /** `grid` suits short values (sizes); `list` suits names. */
  layout?: 'list' | 'grid';
  /** Offers a "clear" row; the label describes what empty means here. */
  clearLabel?: string;
  /** Lets a value outside the list be typed and kept. */
  allowCustom?: boolean;
  disabled?: boolean;
  /** Sits before the label. For triggers that read as an action, not a field. */
  icon?: React.ReactNode;
  className?: string;
  triggerClassName?: string;
  'aria-label'?: string;
}> = ({
  value, onChange, options, placeholder = 'Select…', searchPlaceholder = 'Search…',
  layout = 'list', clearLabel, allowCustom, disabled, icon, className, triggerClassName,
  'aria-label': ariaLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find(o => o.value === value);
  // A value that is not on the list is still a real value — a custom size
  // typed earlier must show as itself, not as the placeholder.
  const display = selected?.label ?? (value || '');

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, query]);

  const grouped = useMemo(() => {
    const out = new Map<string, PickerOption[]>();
    for (const o of hits) {
      const k = o.group || '';
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(o);
    }
    return [...out.entries()];
  }, [hits]);

  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(''); };
  const typedIsNew = allowCustom && query.trim() && !hits.some(o => o.label === query.trim());

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" disabled={disabled} aria-label={ariaLabel}
          className={cn('w-full justify-start font-normal', !display && 'text-muted-foreground', triggerClassName)}
        >
          {icon && <span className="mr-1.5 flex-shrink-0">{icon}</span>}
          <span className="truncate">{display || placeholder}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 ml-auto flex-shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className={cn('p-0', layout === 'grid' ? 'w-[17rem]' : 'w-[15rem]', className)} align="start">
        <div className="p-2 border-b">
          <Input
            autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder} aria-label={searchPlaceholder}
            className="h-8 text-sm"
            onKeyDown={e => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (hits.length === 1) pick(hits[0].value);
              else if (typedIsNew) pick(query.trim());
            }}
          />
        </div>

        <div className="max-h-[15rem] overflow-y-auto p-1.5">
          {grouped.map(([group, items]) => (
            <div key={group || '_'}>
              {group && (
                <p className="px-1.5 pt-1.5 pb-1 text-2xs uppercase tracking-wide text-muted-foreground">{group}</p>
              )}
              {layout === 'grid' ? (
                <div className="grid grid-cols-4 gap-1">
                  {items.map(o => (
                    <button
                      key={o.value} type="button" onClick={() => pick(o.value)}
                      className={cn(
                        'h-9 rounded-md border text-sm tabular-nums hover:bg-accent transition-colors',
                        o.value === value && 'bg-primary text-primary-foreground border-primary',
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              ) : (
                items.map(o => (
                  <button
                    key={o.value} type="button" onClick={() => pick(o.value)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm hover:bg-accent',
                      o.value === value && 'bg-accent',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block text-2xs text-muted-foreground truncate">{o.hint}</span>}
                    </span>
                    {o.value === value && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                  </button>
                ))
              )}
            </div>
          ))}

          {hits.length === 0 && !typedIsNew && (
            <p className="px-2 py-6 text-sm text-muted-foreground text-center">Nothing matches.</p>
          )}

          {typedIsNew && (
            <button
              type="button" onClick={() => pick(query.trim())}
              className="w-full mt-1 px-2 py-2 rounded-md text-left text-sm hover:bg-accent"
            >
              Use <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span>
            </button>
          )}
        </div>

        {clearLabel && value && (
          <div className="border-t p-1.5">
            <button
              type="button" onClick={() => pick('')}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm text-muted-foreground hover:bg-accent"
            >
              <X className="h-3.5 w-3.5 flex-shrink-0" />{clearLabel}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
