"use client";

/**
 * The frame every page sits in.
 *
 * Pages had drifted into eight different container/padding combinations —
 * `py-8 px-4` on nine, `p-4` on eight, `py-4 px-3 md:py-8 md:px-4` on seven —
 * and four different title sizes. Content physically shifted as you navigated,
 * which reads as sloppiness even when nothing is wrong.
 *
 *   <PageShell subtitle="120 orders" action={<Button>New order</Button>}>
 *     …
 *   </PageShell>
 *
 * The heading and its icon come from the navigation registry (lib/nav.ts) for the page's address,
 * so a page is called what its sidebar row or tab calls it (the audit of 2026-10-01); `title` and
 * `icon` override that for a page the registry doesn't name.
 */

import React from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { pageHeading } from '@/lib/nav';

export const PageShell: React.FC<{
  /** The registry's heading for this address when absent. */
  title?: React.ReactNode;
  /** One line under the title — a count, a date, a scope. */
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  /** Buttons pinned to the top right; full width on a phone. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** `wide` for boards and tables; the default suits reading; `medium` a single list (Repairs). */
  width?: 'default' | 'wide' | 'medium' | 'narrow';
  className?: string;
}> = ({ title, subtitle, icon, action, children, width = 'default', className }) => {
  const pathname = usePathname();
  const fromNav = pageHeading(pathname);
  const Icon = fromNav?.icon;
  title ??= fromNav?.title;
  icon ??= Icon ? <Icon className="h-7 w-7" /> : undefined;
  return (
  <div className={cn(
    'container mx-auto px-4 py-5 md:py-6 space-y-4',
    width === 'wide' ? 'max-w-[100rem]' : width === 'narrow' ? 'max-w-3xl' : width === 'medium' ? 'max-w-5xl' : 'max-w-7xl',
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
};
