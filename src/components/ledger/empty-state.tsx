import * as React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** A lucide icon element, e.g. <Inbox />. */
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div role="status" className={cn('flex flex-col items-center gap-1 px-6 py-12 text-center', className)}>
      {icon ? <div aria-hidden className="mb-2 text-muted-foreground/70 [&>svg]:h-10 [&>svg]:w-10">{icon}</div> : null}
      <p className="text-ios-headline font-semibold text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-ios-sub text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
