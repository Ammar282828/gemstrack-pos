'use client';

/**
 * A failing widget takes itself down, not the page.
 *
 * `app/error.tsx` catches whatever throws in a page, but it replaces the whole page. A dashboard card that
 * hits one malformed record, a chart whose chunk did not download, a panel on a website page: each is
 * wrapped in a `SectionBoundary`, which draws a small inline card in the section's place with a Retry
 * (and keeps the rest of the screen working). The error goes to the console with the section's name.
 *
 *   <SectionBoundary name="Recent sales"> … </SectionBoundary>
 *   const SafeChart = withBoundary(Chart, 'Sales over time')       // for a dynamic() chart
 *
 * `LoadError` is the same card for a fetch that failed: a visible message and a Retry, never a blank.
 * Nothing here may throw.
 */

import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The inline card: what failed, and a way back. */
export function LoadError({ title, message, onRetry, className, busy }: {
  title?: string; message?: React.ReactNode; onRetry?: () => void; className?: string; busy?: boolean;
}) {
  return (
    <div role="alert" className={cn('flex items-center gap-3 rounded-card bg-destructive/[.07] p-4', className)}>
      <span aria-hidden className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-ios-sub font-semibold text-foreground">{title ?? 'Could not load this'}</p>
        {message ? <p className="mt-0.5 break-words text-ios-foot text-muted-foreground">{message}</p> : null}
      </div>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" className="flex-shrink-0" onClick={onRetry} disabled={busy}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />Retry
        </Button>
      )}
    </div>
  );
}

interface BoundaryProps { name: string; children?: React.ReactNode; className?: string; fallback?: (retry: () => void) => React.ReactNode }
interface BoundaryState { error: Error | null; attempt: number }

export class SectionBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try { console.error(`[GemsTrack] "${this.props.name}" failed`, error, info.componentStack); } catch { /* nothing */ }
  }

  private retry = () => this.setState(s => ({ error: null, attempt: s.attempt + 1 }));

  render() {
    if (this.state.error) {
      return this.props.fallback
        ? this.props.fallback(this.retry)
        : <LoadError className={this.props.className} title={`${this.props.name} could not be shown`} message="The rest of the page is fine. Nothing saved was changed." onRetry={this.retry} />;
    }
    // `attempt` re-mounts the children on Retry, so a dynamic() chart tries its download again.
    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}

/** A component that can fail on its own (a lazily loaded chart): the same component, inside a boundary. */
export function withBoundary<P extends object>(Component: React.ComponentType<P>, name: string, className?: string): React.ComponentType<P> {
  const Guarded = (props: P) => (
    <SectionBoundary name={name} className={className}><Component {...props} /></SectionBoundary>
  );
  Guarded.displayName = `Guarded(${name})`;
  return Guarded;
}
