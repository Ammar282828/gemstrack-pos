"use client";

/**
 * "Every karigar, at a glance."
 *
 * Screen space is given in proportion to how much someone matters right now:
 * a karigar holding work gets a card showing their numbers *and the oldest
 * pieces they are sitting on* — the thing you actually want to know — while
 * everyone with an empty bench collapses into a single quiet line at the
 * bottom. Nobody is hidden; they just don't get a row of em-dashes each.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Karigar } from '@/lib/store';
import { KarigarWorkload, WorkshopJob, UNASSIGNED_ID, WARN_DAYS, CRITICAL_DAYS, formatJobListForShare } from '@/lib/workshop';
import { STORE_CONFIG } from '@/lib/store-config';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Hammer, AlertTriangle, Flame, Share2, PlusCircle, ChevronRight, Moon, ExternalLink,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { openWhatsApp } from '@/lib/whatsapp';

/** How many pieces to preview on a card before "+N more". */
const PEEK = 3;

export interface GlanceRow {
  karigarId: string;
  karigarName: string;
  isUnassigned: boolean;
  idle: boolean;
  active: number;
  inProgress: number;
  late: number;
  critical: number;
  oldestDays: number;
  orders: number;
  weightG: number;
  value: number;
  /** Oldest-first, for the card preview. */
  peek: WorkshopJob[];
  load?: KarigarWorkload;
}

export function buildGlanceRows(loads: KarigarWorkload[], karigars: Karigar[]): GlanceRow[] {
  const seen = new Set(loads.map(l => l.karigarId));

  const rows: GlanceRow[] = loads.map(l => {
    const active = l.jobs.filter(j => j.status !== 'completed');
    return {
      karigarId: l.karigarId,
      karigarName: l.karigarName,
      isUnassigned: l.karigarId === UNASSIGNED_ID,
      idle: l.active === 0,
      active: l.active,
      inProgress: l.inProgress,
      late: l.overdue - l.critical,
      critical: l.critical,
      oldestDays: l.oldestActiveDays,
      orders: new Set(active.map(j => j.orderId || j.invoiceId).filter(Boolean)).size,
      weightG: l.totalWeightG,
      value: l.totalValue,
      peek: [...active].sort((a, b) => b.ageDays - a.ageDays),
      load: l,
    };
  });

  // An empty bench is still a karigar — they just collapse into one line.
  for (const k of karigars) {
    if (seen.has(k.id)) continue;
    rows.push({
      karigarId: k.id, karigarName: k.name, isUnassigned: false, idle: true,
      active: 0, inProgress: 0, late: 0, critical: 0, oldestDays: 0,
      orders: 0, weightG: 0, value: 0, peek: [],
    });
  }

  return rows.sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? -1 : 1;
    if (a.idle !== b.idle) return a.idle ? 1 : -1;
    if (b.critical !== a.critical) return b.critical - a.critical;
    if (b.late !== a.late) return b.late - a.late;
    if (b.active !== a.active) return b.active - a.active;
    return a.karigarName.localeCompare(b.karigarName);
  });
}

function useShare(contactById: Map<string, string>) {
  const { toast } = useToast();
  return React.useCallback(async (row: GlanceRow) => {
    if (!row.load) return;
    const text = formatJobListForShare(row.load, STORE_CONFIG.name);
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked */ }
    if (openWhatsApp(contactById.get(row.karigarId), text)) {
      toast({ title: 'Opening WhatsApp', description: 'Job list copied too.' });
    } else {
      toast({ title: 'Job list copied', description: 'No phone saved for this karigar — paste it anywhere.' });
    }
  }, [contactById, toast]);
}

/** Age chip used in the piece preview. */
const Age: React.FC<{ days: number }> = ({ days }) => (
  <span className={cn(
    'tabular-nums text-xs font-medium w-9 flex-shrink-0',
    days >= CRITICAL_DAYS ? 'text-destructive'
      : days >= WARN_DAYS ? 'text-warning'
      : 'text-muted-foreground',
  )}>{days}d</span>
);

const KarigarPanel: React.FC<{
  row: GlanceRow;
  onFocus: (id: string) => void;
  onAssign: (id: string) => void;
  onShare: (row: GlanceRow) => void;
}> = ({ row, onFocus, onAssign, onShare }) => {
  const more = row.active - Math.min(row.peek.length, PEEK);

  return (
    <Card className={cn(
      'flex flex-col',
      row.critical > 0 && 'border-destructive/40',
      row.isUnassigned && 'border-destructive/60 bg-destructive/5',
    )}>
      <CardContent className="p-4 flex flex-col flex-1">
        {/* Name + headline count */}
        <button type="button" onClick={() => onFocus(row.karigarId)}
          className="text-left group w-full">
          <div className="flex items-start justify-between gap-2">
            <span className="flex items-center gap-1.5 min-w-0">
              {row.isUnassigned
                ? <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                : <Hammer className="h-4 w-4 text-primary flex-shrink-0" />}
              <span className={cn('font-semibold truncate group-hover:underline',
                row.isUnassigned && 'text-destructive')}>
                {row.isUnassigned ? 'Unassigned' : row.karigarName}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
          </div>

          <div className="flex items-baseline gap-1.5 mt-1.5">
            <span className="text-3xl font-bold tabular-nums leading-none">{row.active}</span>
            <span className="text-sm text-muted-foreground">
              piece{row.active === 1 ? '' : 's'}
            </span>
            {row.oldestDays > 0 && (
              <span className={cn('text-sm ml-auto tabular-nums',
                row.oldestDays >= CRITICAL_DAYS ? 'text-destructive font-medium'
                  : row.oldestDays >= WARN_DAYS ? 'text-warning' : 'text-muted-foreground')}>
                oldest {row.oldestDays}d
              </span>
            )}
          </div>
        </button>

        {(row.critical > 0 || row.late > 0) && (
          <div className="flex items-center gap-1.5 mt-2">
            {row.critical > 0 && (
              <Badge variant="destructive" className="text-2xs">
                <Flame className="h-3 w-3 mr-1" />{row.critical} critical
              </Badge>
            )}
            {row.late > 0 && (
              <Badge variant="outline" className="text-2xs text-warning border-warning/40 bg-warning/10">
                {row.late} late
              </Badge>
            )}
          </div>
        )}

        {/* What they're actually sitting on — oldest first. */}
        {row.peek.length > 0 && (
          <>
            <Separator className="my-3" />
            <ul className="space-y-1.5 text-sm">
              {row.peek.slice(0, PEEK).map(j => (
                <li key={j.id} className="flex items-start gap-2 min-w-0">
                  <Age days={j.ageDays} />
                  <span className="truncate text-foreground/90" title={j.description}>{j.description}</span>
                </li>
              ))}
            </ul>
            {more > 0 && (
              <button type="button" onClick={() => onFocus(row.karigarId)}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline mt-1.5 text-left">
                +{more} more
              </button>
            )}
          </>
        )}

        {/* Exposure + actions, pinned to the bottom so cards align. */}
        <div className="mt-auto pt-3">
          {(row.weightG > 0 || row.value > 0 || row.orders > 0) && (
            <p className="text-xs text-muted-foreground tabular-nums mb-2">
              {[
                row.orders > 0 ? `${row.orders} order${row.orders === 1 ? '' : 's'}` : null,
                row.weightG > 0 ? `${row.weightG.toFixed(1)}g out` : null,
                row.value > 0 ? `PKR ${Math.round(row.value / 1000)}k` : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 text-xs flex-1"
              onClick={() => onFocus(row.karigarId)}>
              Open jobs
            </Button>
            {!row.isUnassigned && (
              <>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0 flex-shrink-0"
                  onClick={() => onShare(row)} aria-label="Send list">
                  <Share2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0 flex-shrink-0"
                  onClick={() => onAssign(row.karigarId)} aria-label="Add work">
                  <PlusCircle className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 flex-shrink-0" asChild aria-label="Open">
                  <Link href={`/karigars/${row.karigarId}`} aria-label="Profile">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export const KarigarGlance: React.FC<{
  loads: KarigarWorkload[];
  karigars: Karigar[];
  contactById: Map<string, string>;
  onFocus: (karigarId: string) => void;
  onAssign: (karigarId: string) => void;
}> = ({ loads, karigars, contactById, onFocus, onAssign }) => {
  const rows = useMemo(() => buildGlanceRows(loads, karigars), [loads, karigars]);
  const onShare = useShare(contactById);
  const [showIdle, setShowIdle] = useState(false);

  const busy = rows.filter(r => !r.idle);
  const idle = rows.filter(r => r.idle);

  const totals = useMemo(() => busy.reduce((t, r) => ({
    active: t.active + r.active,
    critical: t.critical + r.critical,
    late: t.late + r.late,
    weightG: t.weightG + r.weightG,
    value: t.value + r.value,
  }), { active: 0, critical: 0, late: 0, weightG: 0, value: 0 }), [busy]);

  if (rows.length === 0) {
    return (
      <Card><CardContent className="py-12 text-center text-muted-foreground">
        No karigars on record yet.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Bench summary — only the figures that are non-zero carry emphasis. */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3">
            {[
              { label: 'Pieces out', value: String(totals.active) },
              { label: 'Benches working', value: `${busy.filter(r => !r.isUnassigned).length}` },
              { label: `Late ${WARN_DAYS}d+`, value: String(totals.late), tone: totals.late ? 'text-warning' : undefined },
              { label: `Critical ${CRITICAL_DAYS}d+`, value: String(totals.critical), tone: totals.critical ? 'text-destructive' : undefined },
              { label: 'Gold out', value: totals.weightG > 0 ? `${totals.weightG.toFixed(1)}g` : '—' },
              { label: 'Value out', value: totals.value > 0 ? `PKR ${Math.round(totals.value / 1000)}k` : '—' },
            ].map(c => (
              <div key={c.label} className="min-w-0">
                <p className="text-2xs uppercase tracking-wide text-muted-foreground truncate">{c.label}</p>
                <p className={cn('text-lg sm:text-xl font-bold leading-tight tabular-nums truncate', c.tone)}>{c.value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {busy.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Nobody is holding any pieces right now.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {busy.map(r => (
            <KarigarPanel key={r.karigarId} row={r}
              onFocus={onFocus} onAssign={onAssign} onShare={onShare} />
          ))}
        </div>
      )}

      {/* Empty benches: one line, not one row each. Naming them is the point —
          these are the people you can hand the next job to. */}
      {idle.length > 0 && (
        <Card className="bg-muted/30">
          <CardContent className="p-3">
            <button type="button" onClick={() => setShowIdle(v => !v)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full text-left">
              <Moon className="h-4 w-4 flex-shrink-0" />
              <span><span className="font-medium text-foreground">{idle.length}</span> free</span>
              {!showIdle && (
                <span className="truncate min-w-0 hidden sm:inline">
                  — {idle.map(r => r.karigarName).join(', ')}
                </span>
              )}
              <ChevronRight className={cn('h-4 w-4 ml-auto flex-shrink-0 transition-transform', showIdle && 'rotate-90')} />
            </button>

            {showIdle && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {idle.map(r => (
                  <Button key={r.karigarId} size="sm" variant="outline" className="h-8 text-xs"
                    onClick={() => onAssign(r.karigarId)}>
                    <PlusCircle className="h-3.5 w-3.5 mr-1.5" />{r.karigarName}
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
