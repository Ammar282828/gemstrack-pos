'use client';

/**
 * The promised date, and how it is going, in the app's words (PromiseWords in
 * apps/iphone/App/UI/Ledger.swift): "Late 2 days", "Due today", "Due Thu 12 Oct".
 *
 * One component so the orders list, the order page and the workshop all say the
 * same thing in the same words. Colour is the tone ink (late red, due-soon amber,
 * quiet otherwise), which is a theme token, so it survives a palette change.
 */

import React from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { orderTiming, timingLabel, isActiveOrder, isUrgent, type OrderTiming } from '@/lib/order-timing';
import { toneClasses, type Tone } from '@/components/ledger';
import type { Order } from '@/lib/store';

type Sliver = Pick<Order, 'promisedDate' | 'createdAt' | 'status'>;

/** What a promise says, and in which tone (the app's PromiseWords.say). */
export function promiseWords(t: OrderTiming): { text: string; tone: Tone } {
  if (t.state === 'late') {
    if (!t.due) return { text: `No date · ${timingLabel(t)}`, tone: 'late' };
    const d = Math.max(t.daysLate, 1);
    return { text: `Late ${d} day${d === 1 ? '' : 's'}`, tone: 'late' };
  }
  if (t.state === 'today') return { text: 'Due today', tone: 'owed' };
  if (t.state === 'upcoming' && t.due) return { text: `Due ${format(t.due, 'EEE d MMM')}`, tone: isUrgent(t) ? 'owed' : 'quiet' };
  return { text: 'No date', tone: 'quiet' };
}

export const PromiseLine: React.FC<{ order: Sliver; className?: string; icon?: boolean }> = ({ order, className, icon = true }) => {
  // Read the clock once per mount rather than per render, so a long list does
  // not disagree with itself part-way down.
  const [now] = React.useState(() => new Date());
  const t = orderTiming(order, now);

  if (!order.promisedDate) {
    return <p className={cn('text-ios-cap text-muted-foreground', className)}>No date</p>;
  }

  // A finished order's promise is history; only chase what is still open.
  const chase = isActiveOrder(order);
  const words = chase ? promiseWords(t) : { text: `Due ${format(parseISO(order.promisedDate), 'EEE d MMM')}`, tone: 'quiet' as Tone };
  const loud = chase && (words.tone === 'late' || words.tone === 'owed');
  return (
    <p
      className={cn(
        'inline-flex items-center gap-1 text-ios-cap tabular-nums',
        loud ? cn('font-semibold', toneClasses(words.tone).ink) : 'text-muted-foreground',
        className,
      )}
    >
      {icon && <CalendarDays aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      <span>{words.text}</span>
    </p>
  );
};
