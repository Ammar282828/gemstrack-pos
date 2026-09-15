"use client";

/**
 * Choosing a karigar, everywhere that isn't the inline assign control.
 *
 * The ranking rules live here rather than in each caller: thirty-two names on
 * file, a handful actually working, so the ones mid-job come first and the rest
 * sit under a divider. KarigarAssign shares this hook but keeps its own trigger,
 * because it saves on selection and has to show that.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAppStore, Karigar } from '@/lib/store';
import { SearchablePicker } from '@/components/shared/searchable-picker';

export const UNASSIGNED_VALUE = 'none';
const RECENT_KEY = 'karigar_recent_assign';

export function readRecent(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '{}'); } catch { return {}; }
}

export function rememberRecent(karigarId: string) {
  if (typeof window === 'undefined' || !karigarId || karigarId === UNASSIGNED_VALUE) return;
  try {
    const recent = readRecent();
    recent[karigarId] = Date.now();
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch { /* storage may be unavailable */ }
}

export interface RankedKarigars {
  /** Recency order — this browser's own picks outrank historical data. */
  all: Karigar[];
  /** Currently holding at least one unfinished piece — the likely pick. */
  busy: Set<string>;
}

export function useKarigarsByRecency(bump = 0): RankedKarigars {
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

    const busy = new Set<string>();
    for (const o of orders || []) {
      if (!o || o.status === 'Completed' || o.status === 'Cancelled' || o.status === 'Refunded' || o.invoiceId) continue;
      for (const item of (Array.isArray(o.items) ? o.items : [])) {
        if (item?.karigarId && item.karigarId !== UNASSIGNED_VALUE && !item.isCompleted) busy.add(item.karigarId);
      }
    }
    for (const j of karigarJobs || []) {
      if (j?.karigarId && j.status !== 'completed') busy.add(j.karigarId);
    }

    const recent = readRecent();
    const all = [...(karigars || [])].sort((a, b) => {
      const sa = Math.max(recent[a.id] || 0, seen.get(a.id) || 0);
      const sb = Math.max(recent[b.id] || 0, seen.get(b.id) || 0);
      if (sb !== sa) return sb - sa;
      return (a.name || '').localeCompare(b.name || '');
    });
    return { all, busy };
    // `bump` lets a caller re-sort immediately after it makes an assignment
  }, [karigars, orders, karigarJobs, bump]);
}

/** A plain value/onChange field. Pass `clearLabel` to offer "no karigar". */
export const KarigarPicker: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearLabel?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}> = ({ value, onChange, placeholder = 'Choose a karigar', clearLabel, disabled, icon, className, 'aria-label': ariaLabel }) => {
  const { all, busy } = useKarigarsByRecency();
  const addKarigar = useAppStore(s => s.addKarigar);
  const { toast } = useToast();

  /**
   * A karigar made from this very dropdown, held here until the live listener
   * delivers him. Firestore's local write lands in `karigars` within a frame or two,
   * but the picker selects the new id the instant it comes back, and for that frame
   * the id has no name on file — the trigger would flash "karigar-1726…" where the
   * name should be. Keeping the pair here covers the gap without a second lookup.
   */
  const [justMade, setJustMade] = useState<Karigar | null>(null);

  const options = useMemo(() => {
    const pool = justMade && !all.some(k => k.id === justMade.id) ? [justMade, ...all] : all;
    // With nobody mid-job the divider says nothing, so it is left off.
    const anyBusy = pool.some(k => busy.has(k.id));
    const label = (k: Karigar) => (anyBusy ? (busy.has(k.id) ? 'Currently assigned' : 'Other karigars') : '');
    return [...pool]
      .sort((a, b) => Number(busy.has(b.id)) - Number(busy.has(a.id)))
      .map(k => ({
        value: k.id,
        label: k.name || k.id,
        hint: busy.has(k.id) ? 'Currently has assigned work' : undefined,
        group: label(k),
      }));
  }, [all, busy, justMade]);

  /**
   * Make a karigar from a typed name, right here.
   *
   * The name alone is enough to open a record; contact, specialty and the rest are
   * filled in on his page when someone has them. Asking for those now, in the middle
   * of writing up an order, is how a new karigar ends up assigned as "Other" instead.
   */
  const create = useCallback(async (name: string): Promise<string | null> => {
    const made = await addKarigar({ name: name.trim() });
    if (!made) {
      toast({ title: 'Could not add karigar', description: 'Nothing was saved. Try again.', variant: 'destructive' });
      return null;
    }
    setJustMade(made);
    rememberRecent(made.id);
    toast({ title: `${made.name} added`, description: 'Contact and specialty can be filled in on the Karigars page.' });
    return made.id;
  }, [addKarigar, toast]);

  return (
    <SearchablePicker
      value={value === UNASSIGNED_VALUE ? '' : value}
      onChange={v => { if (v) rememberRecent(v); onChange(v || UNASSIGNED_VALUE); }}
      options={options}
      onCreate={create}
      createNoun="karigar"
      placeholder={placeholder}
      searchPlaceholder="Search or add a karigar…"
      clearLabel={clearLabel}
      disabled={disabled}
      icon={icon}
      triggerClassName={className}
      aria-label={ariaLabel || placeholder}
    />
  );
};
