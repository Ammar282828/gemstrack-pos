"use client";

/**
 * Inline karigar picker for an order item — saves on selection so work can be
 * assigned straight from the order page or the Workshop dashboard, instead of
 * reopening the whole order form.
 */

import React, { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Briefcase, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const UNASSIGNED_VALUE = 'none';

export const KarigarAssign: React.FC<{
  orderId: string;
  itemIndex: number;
  currentKarigarId?: string;
  /** `compact` suits dense rows (workshop list); `default` suits the order page. */
  size?: 'compact' | 'default';
  className?: string;
}> = ({ orderId, itemIndex, currentKarigarId, size = 'default', className }) => {
  const karigars = useAppStore(s => s.karigars);
  const updateOrderItemKarigar = useAppStore(s => s.updateOrderItemKarigar);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const assigned = !!currentKarigarId && currentKarigarId !== UNASSIGNED_VALUE;

  const onChange = async (value: string) => {
    setSaving(true);
    try {
      await updateOrderItemKarigar(orderId, itemIndex, value);
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
  };

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
  const karigars = useAppStore(s => s.karigars);
  const assignOrderItemsToKarigar = useAppStore(s => s.assignOrderItemsToKarigar);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  if (unassignedCount <= 1) return null;

  const onChange = async (value: string) => {
    setSaving(true);
    try {
      await assignOrderItemsToKarigar(orderId, value, true);
      const name = karigars.find(k => k.id === value)?.name || 'karigar';
      toast({ title: `${unassignedCount} items assigned`, description: `All unassigned items → ${name}` });
    } catch {
      toast({ title: 'Error', description: 'Could not assign.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

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
