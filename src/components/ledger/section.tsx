import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LedgerHeading, type LedgerHeadingProps } from './heading';

export interface LedgerSectionProps extends Omit<LedgerHeadingProps, 'className' | 'as'> {
  footer?: React.ReactNode;
  /** Render as a <details> that can fold. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
  /** Rows: each direct child is a row (divided, inset 16). */
  children: React.ReactNode;
}

const CARD = 'overflow-hidden rounded-card bg-card divide-y divide-separator [&>*]:px-4';

/** Heading + an inset-rows card + an optional footer. */
export function LedgerSection({ footer, collapsible, defaultOpen = true, className, children, ...heading }: LedgerSectionProps) {
  const body = (
    <>
      <div className={CARD}>{children}</div>
      {footer ? <div className="px-4 pt-2 text-ios-foot text-muted-foreground">{footer}</div> : null}
    </>
  );
  if (collapsible) {
    return (
      <details open={defaultOpen} className={cn('group space-y-2', className)}>
        <summary className="flex cursor-pointer list-none items-center gap-1 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
          <LedgerHeading {...heading} className="flex-1" />
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-enter group-open:rotate-90 motion-reduce:transition-none" />
        </summary>
        {body}
      </details>
    );
  }
  return (
    <section className={cn('space-y-2', className)}>
      <LedgerHeading {...heading} />
      {body}
    </section>
  );
}
