'use client';

/**
 * Give an order's pieces to karigars, from the Orders hub's card (2026-10-04) — the pickers the
 * order page has, without opening it. Each pick saves at once; when every piece has a karigar the
 * order moves to In Progress by itself (lib/order-stage.ts), so the dialog closes on its own then.
 */

import React, { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KarigarAssign, KarigarBulkAssign } from '@/components/karigar/karigar-assign';
import { pieceCounts } from '@/lib/order-stage';

export function GiveOutDialog({ orderId, open, onOpenChange }: { orderId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  // Read live, so each pick shows as it saves.
  const order = useAppStore(s => s.orders.find(o => o.id === orderId));
  const items = Array.isArray(order?.items) ? order!.items : [];
  const { unassigned, total } = pieceCounts(items);
  useEffect(() => {
    if (open && total > 0 && unassigned === 0) { const t = setTimeout(() => onOpenChange(false), 700); return () => clearTimeout(t); }
  }, [open, unassigned, total, onOpenChange]);
  if (!order) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Give out {order.id}</DialogTitle>
          <DialogDescription>
            {order.customerName || 'Walk-in'} · {total} piece{total === 1 ? '' : 's'}. Each pick saves at once{unassigned > 0 ? `; ${unassigned} still without a karigar` : ' — every piece has a karigar'}.
          </DialogDescription>
        </DialogHeader>
        {unassigned > 1 && <KarigarBulkAssign orderId={order.id} unassignedCount={unassigned} className="w-full justify-center" />}
        <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
          {items.map((item, i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg border p-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.description || `Piece ${i + 1}`}</p>
                <p className="text-xs text-muted-foreground">{[item.karat, item.estimatedWeightG ? `${item.estimatedWeightG}g` : ''].filter(Boolean).join(' · ')}</p>
              </div>
              <KarigarAssign orderId={order.id} itemIndex={i} currentKarigarId={item.karigarId} size="compact" />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
