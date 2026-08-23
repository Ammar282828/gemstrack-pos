"use client";

/**
 * The frame every page sits in.
 *
 * Pages had drifted into eight different container/padding combinations —
 * `py-8 px-4` on nine, `p-4` on eight, `py-4 px-3 md:py-8 md:px-4` on seven —
 * and four different title sizes. Content physically shifted as you navigated,
 * which reads as sloppiness even when nothing is wrong.
 *
 *   <PageShell title="Orders" subtitle="120 orders" icon={<ClipboardList />}
 *              action={<Button>New Order</Button>}>
 *     …
 *   </PageShell>
 */

import React from 'react';
import { cn } from '@/lib/utils';

export const PageShell: React.FC<{
  title: React.ReactNode;
  /** One line under the title — a count, a date, a scope. */
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /** Buttons pinned to the top right; full width on a phone. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** `wide` for boards and tables; the default suits reading. */
  width?: 'default' | 'wide' | 'narrow';
  className?: string;
}> = ({ title, subtitle, icon, action, children, width = 'default', className }) => (
  <div className={cn(
    'container mx-auto px-4 py-5 md:py-6 space-y-4',
    width === 'wide' ? 'max-w-[100rem]' : width === 'narrow' ? 'max-w-3xl' : 'max-w-7xl',
    className,
  )}>
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5 min-w-0">
          {icon && <span className="flex-shrink-0">{icon}</span>}
          <span className="truncate">{title}</span>
        </h1>
        {subtitle && (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      {action && (
        <div className="flex gap-2 flex-shrink-0 [&>*]:flex-1 sm:[&>*]:flex-none">{action}</div>
      )}
    </header>
    {children}
  </div>
);
