"use client";

/**
 * Shared workshop job presentation.
 *
 * `AgeBadge` is the single place that turns a job's age into the colour every
 * workshop surface uses; `BoardJobCard` is the board tile.
 */

import React from 'react';
import Link from 'next/link';
import { WorkshopJob, UNASSIGNED_ID } from '@/lib/workshop';
import { KarigarAssign } from '@/components/karigar/karigar-assign';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

export const AgeBadge: React.FC<{ job: WorkshopJob }> = ({ job }) => {
  if (job.status === 'completed') {
    return <Badge variant="outline" className="text-success border-success/40 bg-success/10">Done</Badge>;
  }
  const cls = job.urgency === 'critical'
    ? 'text-destructive border-destructive/40 bg-destructive/10'
    : job.urgency === 'warning'
      ? 'text-warning border-warning/40 bg-warning/10'
      : 'text-muted-foreground';
  return <Badge variant="outline" className={cn('tabular-nums', cls)}>{job.ageDays}d</Badge>;
};

export /** One piece as a board card. The board is scanned, not read, so the card
 *  leads with the sample picture and the piece name; everything else is a
 *  single supporting line. */
const BoardJobCard: React.FC<{
  job: WorkshopJob;
  onToggleDone: (j: WorkshopJob) => void;
  onEdit: (j: WorkshopJob) => void;
  showKarigar?: boolean;
}> = ({ job, onToggleDone, onEdit, showKarigar }) => {
  const spec = [
    job.size ? `Size ${job.size}` : null,
    job.weightG ? `${job.weightG}g` : null,
    job.plating,
    job.category,
  ].filter(Boolean).join(' · ');
  const done = job.status === 'completed';
  const canAssign = job.source !== 'manual' && job.itemIndex !== undefined && !done;

  return (
    <Card className={cn(
      'flex flex-col overflow-hidden transition-shadow hover:shadow-md',
      done && 'opacity-60',
      job.isOnline && 'bg-success/[0.05] border-success/30',
      !done && job.urgency === 'critical' && 'border-destructive/50',
      !done && job.urgency === 'warning' && 'border-warning/50',
    )}>
      {job.sampleImage && (
        // eslint-disable-next-line @next/next/no-img-element -- data: URI, no loader
        <img src={job.sampleImage} alt="" className="h-28 w-full object-cover bg-muted" loading="lazy" decoding="async" />
      )}

      <CardContent className="p-3 flex flex-col gap-1.5 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <Checkbox
              className="mt-0.5 h-5 w-5 sm:h-4 sm:w-4 flex-shrink-0"
              checked={done}
              onCheckedChange={() => onToggleDone(job)}
              aria-label="Mark done"
            />
            <span className={cn('font-medium text-sm leading-snug break-words', done && 'line-through')}>
              {job.description}
            </span>
          </div>
          <span className="flex-shrink-0"><AgeBadge job={job} /></span>
        </div>

        {spec && <p className="text-xs text-muted-foreground">{spec}</p>}

        <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
          {job.source === 'manual'
            ? <Badge variant="secondary" className="text-2xs bg-violet-500/15 text-violet-700 dark:text-violet-300">Stock</Badge>
            : job.isOnline
              ? <Badge variant="secondary" className="text-2xs bg-success/15 text-success">Online</Badge>
              : null}
          {job.invoiceId
            ? <Link href={`/view-invoice/${job.invoiceId}`} className="font-mono text-success hover:underline">{job.invoiceId}</Link>
            : job.orderId
              ? <Link href={`/orders/${job.orderId}`} className="font-mono text-primary hover:underline">{job.orderId}</Link>
              : null}
          {job.customerName && <span className="truncate">{job.customerName}</span>}
        </div>

        {/* The assign dropdown below already names the karigar, so the badge
            is only for cards that don't get one (stock jobs, completed work). */}
        {showKarigar && !canAssign && (
          <Badge variant="outline" className={cn('text-2xs w-fit', job.karigarId === UNASSIGNED_ID && 'text-destructive border-destructive/40')}>
            {job.karigarName}
          </Badge>
        )}

        {job.notes && (
          <div className="rounded-md border border-warning/25 bg-warning/[0.06] px-2 py-1.5 mt-0.5" title={job.notes}>
            <p className="text-xs text-foreground/80 line-clamp-3 whitespace-pre-wrap">{job.notes}</p>
          </div>
        )}

        {/* Actions pinned to the bottom so cards in a row line up. */}
        <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-2">
          {canAssign && job.itemIndex !== undefined && (
            <KarigarAssign orderId={job.orderId} invoiceId={job.invoiceId} itemIndex={job.itemIndex}
              currentKarigarId={job.karigarId === UNASSIGNED_ID ? undefined : job.karigarId}
              size="compact" className="w-full" />
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onEdit(job)}>
            <Pencil className="h-3 w-3 mr-1.5" />Details
          </Button>
          <span className="ml-auto text-2xs text-muted-foreground">
            {format(parseISO(job.assignedDate), 'dd MMM')}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};
