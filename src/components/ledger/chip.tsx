import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ChipRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible name for the group, e.g. "Status". */
  label?: string;
}

/** Horizontal scroll of chips: gap 8, gutter 16, no scrollbar. */
export const ChipRow = React.forwardRef<HTMLDivElement, ChipRowProps>(function ChipRow({ label, className, children, ...rest }, ref) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={cn('-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
      {...rest}
    >
      {children}
    </div>
  );
});

export interface FilterChipProps {
  title: string;
  count?: number;
  chosen: boolean;
  onClick: () => void;
  className?: string;
}

export function FilterChip({ title, count, chosen, onClick, className }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[13px] text-ios-sub transition-colors duration-150 ease-exit motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        chosen ? 'bg-primary font-semibold text-primary-foreground' : 'border border-muted-foreground/[.18] bg-card font-medium text-foreground',
        className,
      )}
    >
      {title}
      {count !== undefined ? <span className={cn('tabular-nums', chosen ? 'opacity-80' : 'text-muted-foreground')}>{count}</span> : null}
    </button>
  );
}
