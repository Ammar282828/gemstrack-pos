'use client';

/**
 * The promised date, and how it is going.
 *
 * One component so the orders list, the order page and the workshop all say
 * the same thing in the same words. Colour is carried by --destructive and
 * --warning, which are theme tokens, so it survives a palette change.
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { orderTiming, timingLabel, isActiveOrder, isUrgent } from '@/lib/order-timing';
import type { Order } from '@/lib/store';

type Sliver = Pick<Order, 'promisedDate' | 'createdAt' | 'status'>;

export const PromiseLine: React.FC<{ order: Sliver; className?: string }> = ({ order, className }) => {
  // Read the clock once per mount rather than per render, so a long list does
  // not disagree with itself part-way down.
  const [now] = React.useState(() => new Date());
  const t = orderTiming(order, now);

  if (!order.promisedDate) {
    return <p className={cn('text-xs text-muted-foreground', className)}>no date promised</p>;
  }

  // A finished order's promise is history; only chase what is still open.
  const chase = isActiveOrder(order);
  const urgent = chase && isUrgent(t);
  return (
    <p
      className={cn(
        'text-xs tabular-nums flex items-center gap-1.5 flex-wrap',
        chase && t.state === 'late' ? 'text-destructive font-medium'
          : chase && t.state === 'today' ? 'text-warning font-medium'
          : urgent ? 'text-destructive'
          : 'text-muted-foreground',
        className,
      )}
    >
      {/* Promised inside a bench week. Loud on purpose: this is the one thing on the
          row that changes what the workshop does today. */}
      {urgent && (
        <span className="inline-flex items-center rounded-sm bg-destructive px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-destructive-foreground leading-none">
          Urgent
        </span>
      )}
      <span>
        due {format(parseISO(order.promisedDate), 'd MMM')}
        {chase && (t.state !== 'upcoming' || urgent) && ` · ${timingLabel(t)}`}
      </span>
    </p>
  );
};
