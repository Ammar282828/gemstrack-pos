'use client';

/**
 * An order's next step, on its card in the Orders hub (2026-10-04). The audit found each order
 * saved about 4.4 times after it was made, from the list → the order → its menu → the form or the
 * status pill → Finalize → the invoice. Each stage now has its one action on the card itself:
 *
 *   Not started     Give out — the karigar pickers (the order moves to In Progress by itself)
 *   With karigars   Mark ready — Completed, every piece ticked
 *   Ready           Finalize & invoice — the order's own dialog, then the invoice to take the rest
 *   Invoiced        nothing to do here — money is taken on the invoice only (the owner, 2026-10-06:
 *                   "stop showing take money option since its only from invoice"); a quiet link to it
 *   Online, unpaid  Check transfer — the slips, the hold, Transfer received or Let it lapse
 *
 * and an advance can be recorded from any order still being made (dated today).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { Banknote, CheckCircle2, CreditCard, FileText, Loader2, UserPlus } from 'lucide-react';
import { useAppStore, type Order } from '@/lib/store';
import { stageOf } from '@/lib/order-stage';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FinalizeOrderDialog, RecordAdvanceDialog } from './order-dialogs';
import { GiveOutDialog } from './give-out-dialog';
import { TransferDialog } from './website-order-panel';

export function NextStep({ order, owed, className, size = 'sm', compact = false }: { order: Order; owed: number; className?: string; size?: 'sm' | 'default'; /** The advance as an icon only (the desktop table). */ compact?: boolean }) {
  const { toast } = useToast();
  const updateOrderStatus = useAppStore(s => s.updateOrderStatus);
  const [open, setOpen] = useState<'finalize' | 'advance' | 'give' | 'transfer' | null>(null);
  const [busy, setBusy] = useState(false);
  const stage = stageOf(order, owed);
  const making = stage === 'new' || stage === 'karigar' || stage === 'ready';

  const markReady = async () => {
    setBusy(true);
    try {
      await updateOrderStatus(order.id, 'Completed');
      toast({ title: `${order.id} is ready`, description: 'Every piece ticked. Finalize & invoice when it is collected.' });
    } catch {
      toast({ title: 'Not changed', description: 'The order could not be marked ready.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const h = size === 'sm' ? 'h-8' : 'h-10';
  return (
    // The card behind opens the order; nothing here should.
    <div className={cn('flex items-center gap-1.5', className)} onClick={e => e.stopPropagation()}>
      {stage === 'transfer' && (
        <Button type="button" size="sm" variant={order.website?.paymentStatus === 'slip_sent' ? 'default' : 'secondary'} className={h} onClick={() => setOpen('transfer')}>
          <Banknote className="mr-1.5 h-4 w-4" />{order.website?.paymentStatus === 'slip_sent' ? 'Slip in — check' : 'Check transfer'}
        </Button>
      )}
      {stage === 'new' && <Button type="button" size="sm" className={h} onClick={() => setOpen('give')}><UserPlus className="mr-1.5 h-4 w-4" />Give out</Button>}
      {stage === 'karigar' && (
        <Button type="button" size="sm" variant="secondary" className={h} disabled={busy} onClick={markReady}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Mark ready
        </Button>
      )}
      {stage === 'ready' && <Button type="button" size="sm" className={h} onClick={() => setOpen('finalize')}><FileText className="mr-1.5 h-4 w-4" />Finalize &amp; invoice</Button>}
      {order.invoiceId && (
        <Link href={`/invoices/${order.invoiceId}`} className="text-xs text-muted-foreground underline-offset-2 hover:underline whitespace-nowrap">
          Invoiced · {order.invoiceId}
        </Link>
      )}
      {making && (
        <Button type="button" size="sm" variant="ghost" className={cn(h, 'px-2 text-muted-foreground')} onClick={() => setOpen('advance')} title="Record an advance" aria-label="Record an advance">
          <CreditCard className="h-4 w-4" />{!compact && <span className="ml-1 hidden sm:inline">Advance</span>}
        </Button>
      )}
      {open === 'transfer' && <TransferDialog order={order} open onOpenChange={o => !o && setOpen(null)} />}
      {open === 'give' && <GiveOutDialog orderId={order.id} open onOpenChange={o => !o && setOpen(null)} />}
      {open === 'finalize' && <FinalizeOrderDialog order={order} open onOpenChange={o => !o && setOpen(null)} />}
      {open === 'advance' && <RecordAdvanceDialog order={order} open onOpenChange={o => !o && setOpen(null)} />}
    </div>
  );
}
