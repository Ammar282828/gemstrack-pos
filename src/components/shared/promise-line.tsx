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
import { orderTiming, timingLabel, isActiveOrder } from '@/lib/order-timing';
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
  return (
    <p
      className={cn(
        'text-xs tabular-nums',
        chase && t.state === 'late' ? 'text-destructive font-medium'
          : chase && t.state === 'today' ? 'text-warning font-medium'
          : 'text-muted-foreground',
        className,
      )}
    >
      due {format(parseISO(order.promisedDate), 'd MMM')}
      {chase && t.state !== 'upcoming' && ` · ${timingLabel(t)}`}
    </p>
  );
};
