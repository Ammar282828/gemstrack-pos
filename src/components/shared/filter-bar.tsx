"use client";

/**
 * The search-and-filter row that sits above every list.
 *
 * It was hand-rolled on each page and had drifted into four different shapes:
 * a card with a three-column grid, a card with a flex row, a bare div with no
 * card at all, and a card with different padding again. Same control, four
 * layouts, four sets of breakpoints. This is the one shape.
 *
 *   <FilterBar value={q} onChange={setQ} placeholder="Search orders…">
 *     <Select …/>
 *     <Select …/>
 *   </FilterBar>
 */

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const FilterBar: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Selects and toggles. Two-up on a phone, inline from sm. */
  children?: React.ReactNode;
  /** Buttons pinned to the end of the row (export, add, etc). */
  actions?: React.ReactNode;
  /** Extra content below the row — active-filter chips, summaries. */
  footer?: React.ReactNode;
  className?: string;
}> = ({ value, onChange, placeholder = 'Search…', children, actions, footer, className }) => (
  <Card className={cn('mb-4', className)}>
    <CardContent className="p-3 sm:p-4 space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            className="pl-8 pr-8"
            placeholder={placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            aria-label={placeholder}
          />
          {value && (
            <Button
              type="button" variant="ghost" size="icon"
              className="absolute right-0.5 top-0.5 h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => onChange('')} aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* `sm:contents` dissolves this wrapper above the breakpoint so the
            filters rejoin the parent flex row instead of staying a 2-up grid. */}
        {children && (
          <div className="grid grid-cols-2 gap-2 sm:contents">{children}</div>
        )}

        {actions && <div className="flex gap-2 flex-shrink-0">{actions}</div>}
      </div>
      {footer}
    </CardContent>
  </Card>
);
