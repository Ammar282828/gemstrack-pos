import * as React from 'react';
import { format, parseISO } from 'date-fns';
import { Printer, Edit, Trash2, MessageCircle, CheckCircle2, PackageCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Monogram, Pill, RowAmount, type Tone } from '@/components/ledger';
import { REPAIR_STATUS_LABELS, repairBalance, repairPaid, repairTotal, type RepairStatus } from '@/lib/repairs';
import type { Repair } from '@/lib/store';
import { cn } from '@/lib/utils';

/** In the shop (with us), Ready (settled), Collected (quiet): each in its one tone. */
export const REPAIR_STATUS_TONE: Record<RepairStatus, Tone> = {
  received: 'working',
  ready: 'settled',
  collected: 'quiet',
  cancelled: 'quiet',
};

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
const day = (iso?: string) => { if (!iso) return ''; try { return format(parseISO(iso), 'd MMM'); } catch { return iso; } };

/** One repair ticket: who, what, the money and the next step. The page owns every action. */
export function RepairCard({ repair: r, late, whatsappHref, onEdit, onReady, onHandBack, onPrint, onCancel, onDelete }: {
  repair: Repair;
  /** Days past its ready-by date, or null. */
  late: number | null;
  /** The "Tell them" link when the ticket is ready and has a number. */
  whatsappHref?: string | null;
  onEdit: () => void;
  onReady: () => void;
  onHandBack: () => void;
  onPrint: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const bal = repairBalance(r);
  return (
    <div className={cn('rounded-card bg-card p-4', r.status === 'collected' || r.status === 'cancelled' ? 'opacity-70' : '')}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {/* Who and what */}
        <button type="button" onClick={onEdit} className="min-w-[min(100%,20rem)] flex-1 text-left">
          <div className="flex items-start gap-3">
            <Monogram name={r.customerName} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-ios-headline font-semibold">{r.customerName || 'Walk-in'}</p>
              {r.customerContact && <p className="truncate text-ios-sub tabular-nums text-muted-foreground">{r.customerContact}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Pill tone={REPAIR_STATUS_TONE[r.status]}>{REPAIR_STATUS_LABELS[r.status]}</Pill>
              {late ? <Pill tone="late">{late}d late</Pill> : null}
            </div>
          </div>
          <ul className="mt-2 space-y-0.5 pl-[52px] text-ios-sub">
            {(r.pieces || []).map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-3.5 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0"><span className="font-medium">{p.item}</span>{p.work ? <span className="text-muted-foreground"> — {p.work}</span> : null}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 pl-[52px] text-ios-cap text-muted-foreground">
            {r.id} · in {day(r.receivedAt)}
            {r.status === 'received' && r.promisedDate && <span className={cn(late && 'font-medium text-tone-late-ink')}> · ready by {day(r.promisedDate)}{late ? ` (${late}d late)` : ''}</span>}
            {r.karigarName && ` · with ${r.karigarName}`}
          </p>
        </button>

        {/* Money and the next step */}
        <div className="flex flex-col items-end gap-2 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
          <p className="text-sm tabular-nums">
            {bal > 0 ? <><span className="text-ios-cap text-muted-foreground">due </span><RowAmount amount={bal} tone="owed" /></> : repairTotal(r) > 0 ? <span className="text-ios-cap text-muted-foreground">paid</span> : null}
          </p>
          <div className="flex items-center gap-1">
            {r.status === 'received' && <Button size="sm" variant="outline" className="h-8 border-tone-settled-ink text-tone-settled-ink hover:bg-tone-settled/10" onClick={onReady}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Ready</Button>}
            {r.status === 'ready' && whatsappHref && (
              <Button asChild size="sm" variant="outline" className="h-8 border-tone-settled-ink/60 text-tone-settled-ink">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label="Tell the customer on WhatsApp"><MessageCircle className="mr-1.5 h-3.5 w-3.5" />Tell them</a>
              </Button>
            )}
            {r.status === 'ready' && <Button size="sm" className="h-8" onClick={onHandBack}><PackageCheck className="mr-1.5 h-3.5 w-3.5" />Hand back</Button>}
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Print the receipt" onClick={onPrint}><Printer className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit" onClick={onEdit}><Edit className="h-4 w-4" /></Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" aria-label="Cancel or delete"><Trash2 className="h-4 w-4" /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{r.id}: cancel or delete?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cancel keeps the record (handed back unrepaired). Delete removes it for good
                    {repairPaid(r) ? `, and the ${pkr(repairPaid(r))} paid comes out of Extra Revenue with it` : ''}.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  {(r.status === 'received' || r.status === 'ready') && (
                    <AlertDialogAction className="bg-secondary text-secondary-foreground hover:bg-secondary/80" onClick={onCancel}>Cancel repair</AlertDialogAction>
                  )}
                  <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </div>
  );
}
