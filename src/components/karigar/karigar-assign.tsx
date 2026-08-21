"use client";

/**
 * Inline karigar picker for an order item — saves on selection so work can be
 * assigned straight from the order page or the Workshop dashboard, instead of
 * reopening the whole order form.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useAppStore, Karigar } from '@/lib/store';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Briefcase, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const UNASSIGNED_VALUE = 'none';
const RECENT_KEY = 'karigar_recent_assign';

function readRecent(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '{}'); } catch { return {}; }
}

function rememberRecent(karigarId: string) {
  if (typeof window === 'undefined' || !karigarId || karigarId === UNASSIGNED_VALUE) return;
  try {
    const recent = readRecent();
    recent[karigarId] = Date.now();
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch { /* storage may be unavailable */ }
}

/**
 * Karigars ordered so the ones you assigned to most recently come first.
 * Seeded from real data (latest order / job they were assigned) so the list is
 * already sensible before this browser has recorded any picks of its own.
 */
function useKarigarsByRecency(bump: number): Karigar[] {
  const karigars = useAppStore(s => s.karigars);
  const orders = useAppStore(s => s.orders);
  const karigarJobs = useAppStore(s => s.karigarJobs);

  return useMemo(() => {
    const seen = new Map<string, number>();
    const note = (id: string | undefined, t: number) => {
      if (!id || id === UNASSIGNED_VALUE || Number.isNaN(t)) return;
      seen.set(id, Math.max(seen.get(id) || 0, t));
    };

    for (const o of orders || []) {
      const t = new Date(o?.createdAt || 0).getTime();
      for (const item of (Array.isArray(o?.items) ? o.items : [])) note(item?.karigarId, t);
    }
    for (const j of karigarJobs || []) note(j?.karigarId, new Date(j?.assignedDate || 0).getTime());

    const recent = readRecent(); // this browser's own picks outrank historical data
    return [...(karigars || [])].sort((a, b) => {
      const sa = Math.max(recent[a.id] || 0, seen.get(a.id) || 0);
      const sb = Math.max(recent[b.id] || 0, seen.get(b.id) || 0);
      if (sb !== sa) return sb - sa;
      return (a.name || '').localeCompare(b.name || '');
    });
    // `bump` re-sorts immediately after an assignment is made from this component
  }, [karigars, orders, karigarJobs, bump]);
}

export const KarigarAssign: React.FC<{
  orderId: string;
  itemIndex: number;
  currentKarigarId?: string;
  /** `compact` suits dense rows (workshop list); `default` suits the order page. */
  size?: 'compact' | 'default';
  className?: string;
}> = ({ orderId, itemIndex, currentKarigarId, size = 'default', className }) => {
  const updateOrderItemKarigar = useAppStore(s => s.updateOrderItemKarigar);
  const [saving, setSaving] = useState(false);
  const [bump, setBump] = useState(0);
  const karigars = useKarigarsByRecency(bump);
  const { toast } = useToast();

  const assigned = !!currentKarigarId && currentKarigarId !== UNASSIGNED_VALUE;

  const onChange = useCallback(async (value: string) => {
    setSaving(true);
    try {
      await updateOrderItemKarigar(orderId, itemIndex, value);
      rememberRecent(value);
      setBump(b => b + 1);
      const name = value === UNASSIGNED_VALUE ? null : karigars.find(k => k.id === value)?.name;
      toast({
        title: name ? `Assigned to ${name}` : 'Karigar cleared',
        description: `${orderId} · item ${itemIndex + 1}`,
      });
    } catch {
      toast({ title: 'Error', description: 'Could not assign karigar.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [updateOrderItemKarigar, orderId, itemIndex, karigars, toast]);

  const compact = size === 'compact';

  return (
    <Select value={assigned ? currentKarigarId : UNASSIGNED_VALUE} onValueChange={onChange} disabled={saving}>
      <SelectTrigger
        className={cn(
          compact ? 'h-7 text-xs w-[150px]' : 'h-8 text-sm w-[200px]',
          !assigned && 'text-destructive border-destructive/40',
          className,
        )}
      >
        {saving ? (
          <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Saving…</span>
        ) : (
          <span className="flex items-center gap-1.5 truncate">
            {assigned ? <Briefcase className="h-3 w-3 flex-shrink-0" /> : <UserPlus className="h-3 w-3 flex-shrink-0" />}
            <SelectValue placeholder="Assign karigar" />
          </span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
        {karigars.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
};

/** "Assign all items on this order" — for multi-item orders. */
export const KarigarBulkAssign: React.FC<{
  orderId: string;
  unassignedCount: number;
  className?: string;
}> = ({ orderId, unassignedCount, className }) => {
  const assignOrderItemsToKarigar = useAppStore(s => s.assignOrderItemsToKarigar);
  const [saving, setSaving] = useState(false);
  const [bump, setBump] = useState(0);
  const karigars = useKarigarsByRecency(bump);
  const { toast } = useToast();

  const onChange = useCallback(async (value: string) => {
    setSaving(true);
    try {
      await assignOrderItemsToKarigar(orderId, value, true);
      rememberRecent(value);
      setBump(b => b + 1);
      const name = karigars.find(k => k.id === value)?.name || 'karigar';
      toast({ title: `${unassignedCount} items assigned`, description: `All unassigned items → ${name}` });
    } catch {
      toast({ title: 'Error', description: 'Could not assign.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [assignOrderItemsToKarigar, orderId, karigars, unassignedCount, toast]);

  if (unassignedCount <= 1) return null;

  return (
    <Select onValueChange={onChange} disabled={saving}>
      <SelectTrigger className={cn('h-8 text-xs w-auto gap-1.5', className)}>
        {saving
          ? <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Assigning…</span>
          : <span className="flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" />Assign all {unassignedCount} unassigned</span>}
      </SelectTrigger>
      <SelectContent>
        {karigars.map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
};
