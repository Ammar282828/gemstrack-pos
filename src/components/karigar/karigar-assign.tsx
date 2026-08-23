"use client";

/**
 * Inline karigar picker for an order item — saves on selection so work can be
 * assigned straight from the order page or the Workshop dashboard, instead of
 * reopening the whole order form.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useAppStore, Karigar } from '@/lib/store';
import { UNASSIGNED_VALUE, rememberRecent, useKarigarsByRecency, KarigarPicker } from './karigar-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Briefcase, UserPlus, Check, ChevronsUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export const KarigarAssign: React.FC<{
  /** Bench work hangs off either an order or an invoice (a sold piece coming
   *  back for resizing, or a Shopify sale, which lands as an invoice). */
  orderId?: string;
  invoiceId?: string;
  itemIndex: number;
  currentKarigarId?: string;
  /** `compact` suits dense rows (workshop list); `default` suits the order page. */
  size?: 'compact' | 'default';
  className?: string;
}> = ({ orderId, invoiceId, itemIndex, currentKarigarId, size = 'default', className }) => {
  const updateOrderItemKarigar = useAppStore(s => s.updateOrderItemKarigar);
  const updateInvoiceItemKarigar = useAppStore(s => s.updateInvoiceItemKarigar);
  const [saving, setSaving] = useState(false);
  const [bump, setBump] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { all, busy } = useKarigarsByRecency(bump);
  const { toast } = useToast();

  const assigned = !!currentKarigarId && currentKarigarId !== UNASSIGNED_VALUE;
  const currentName = all.find(k => k.id === currentKarigarId)?.name;

  const commit = useCallback(async (value: string) => {
    setOpen(false);
    setSaving(true);
    try {
      if (invoiceId) await updateInvoiceItemKarigar(invoiceId, itemIndex, value);
      else if (orderId) await updateOrderItemKarigar(orderId, itemIndex, value);
      else return;
      rememberRecent(value);
      setBump(b => b + 1);
      const name = value === UNASSIGNED_VALUE ? null : all.find(k => k.id === value)?.name;
      toast({
        title: name ? `Assigned to ${name}` : 'Karigar cleared',
        description: `${invoiceId || orderId} · item ${itemIndex + 1}`,
      });
    } catch {
      toast({ title: 'Error', description: 'Could not assign karigar.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }, [updateOrderItemKarigar, updateInvoiceItemKarigar, orderId, invoiceId, itemIndex, all, toast]);

  /* Thirty-two names in one flat dropdown, when a handful are actually
     working, meant scrolling past everyone to reach the same few. Typing
     filters; otherwise the ones mid-job come first and the rest sit under a
     divider. */
  const { working, others } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (k: Karigar) => !q || (k.name || '').toLowerCase().includes(q);
    const hits = all.filter(match);
    return {
      working: hits.filter(k => busy.has(k.id)),
      others: hits.filter(k => !busy.has(k.id)),
    };
  }, [all, busy, query]);

  const compact = size === 'compact';

  const Row: React.FC<{ k: Karigar }> = ({ k }) => (
    <button
      type="button"
      onClick={() => commit(k.id)}
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-sm hover:bg-accent',
        k.id === currentKarigarId && 'bg-accent',
      )}
    >
      <Briefcase className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      <span className="truncate flex-1">{k.name}</span>
      {busy.has(k.id) && <span className="h-1.5 w-1.5 rounded-full bg-success flex-shrink-0" title="Has work on the bench" />}
      {k.id === currentKarigarId && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          className={cn(
            'justify-start font-normal',
            compact ? 'h-7 text-xs w-[165px] px-2' : 'h-8 text-sm w-[200px] px-2.5',
            !assigned && 'text-destructive border-destructive/40',
            className,
          )}
        >
          {saving
            ? <><Loader2 className="h-3 w-3 mr-1.5 flex-shrink-0 animate-spin" /><span className="truncate">Saving…</span></>
            : <>
                {assigned
                  ? <Briefcase className="h-3 w-3 mr-1.5 flex-shrink-0" />
                  : <UserPlus className="h-3 w-3 mr-1.5 flex-shrink-0" />}
                <span className="truncate">{assigned ? (currentName || 'Karigar') : 'Assign karigar'}</span>
                <ChevronsUpDown className="h-3 w-3 ml-auto flex-shrink-0 opacity-50" />
              </>}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[16rem] p-0" align="start">
        <div className="p-2 border-b">
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search karigars…"
            aria-label="Search karigars"
            className="h-8 text-sm"
          />
        </div>

        <div className="max-h-[15rem] overflow-y-auto p-1">
          {working.length > 0 && (
            <>
              <p className="px-2.5 pt-1.5 pb-1 text-2xs uppercase tracking-wide text-muted-foreground">On the bench</p>
              {working.map(k => <Row key={k.id} k={k} />)}
            </>
          )}
          {others.length > 0 && (
            <>
              {working.length > 0 && (
                <p className="px-2.5 pt-2 pb-1 text-2xs uppercase tracking-wide text-muted-foreground">Everyone else</p>
              )}
              {others.map(k => <Row key={k.id} k={k} />)}
            </>
          )}
          {working.length === 0 && others.length === 0 && (
            <p className="px-2.5 py-6 text-sm text-muted-foreground text-center">No karigar matches.</p>
          )}
        </div>

        {assigned && (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => commit(UNASSIGNED_VALUE)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-sm text-destructive hover:bg-destructive/10"
            >
              <UserPlus className="h-3.5 w-3.5 flex-shrink-0" />Remove karigar
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
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
  const { all: karigars } = useKarigarsByRecency(bump);
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
    <KarigarPicker
      value=""
      onChange={onChange}
      disabled={saving}
      icon={saving
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <UserPlus className="h-3.5 w-3.5" />}
      placeholder={saving ? 'Assigning…' : `Assign all ${unassignedCount} unassigned`}
      className={cn('h-8 text-xs w-auto gap-1.5 whitespace-nowrap', className)}
      aria-label={`Assign all ${unassignedCount} unassigned items`}
    />
  );
};
