"use client";

/**
 * Choosing a karigar, everywhere that isn't the inline assign control.
 *
 * The ranking rules live here rather than in each caller: thirty-two names on
 * file, a handful actually working, so the ones mid-job come first and the rest
 * sit under a divider. KarigarAssign shares this hook but keeps its own trigger,
 * because it saves on selection and has to show that.
 */

import React, { useMemo } from 'react';
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

  const options = useMemo(() => {
    // With nobody mid-job the divider says nothing, so it is left off.
    const anyBusy = all.some(k => busy.has(k.id));
    const label = (k: Karigar) => (anyBusy ? (busy.has(k.id) ? 'On the bench' : 'Everyone else') : '');
    return [...all]
      .sort((a, b) => Number(busy.has(b.id)) - Number(busy.has(a.id)))
      .map(k => ({
        value: k.id,
        label: k.name || k.id,
        hint: busy.has(k.id) ? 'Has work on the bench' : undefined,
        group: label(k),
      }));
  }, [all, busy]);

  return (
    <SearchablePicker
      value={value === UNASSIGNED_VALUE ? '' : value}
      onChange={v => { if (v) rememberRecent(v); onChange(v || UNASSIGNED_VALUE); }}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="Search karigars…"
      clearLabel={clearLabel}
      disabled={disabled}
      icon={icon}
      triggerClassName={className}
      aria-label={ariaLabel || placeholder}
    />
  );
};
