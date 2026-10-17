'use client';

/**
 * What the Insights pages share: loading /api/insights by part and range, the range picker (kept
 * per device, apart from Ads' because Instagram stops at 30 days), tiles with the change against
 * the period before, and horizontal bars for shares.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/app/ads/ads-kit';
import { INSIGHT_RANGES, isInsightRange, type InsightRange } from '@/lib/social-insights/shape';

const RANGE_KEY = 'taheri_insights_range';

export function useInsightRange(): [InsightRange, (r: InsightRange) => void] {
  const [r, setR] = useState<InsightRange>('last_28d');
  useEffect(() => { try { const v = localStorage.getItem(RANGE_KEY); if (isInsightRange(v)) setR(v); } catch { /* private mode */ } }, []);
  return [r, (v: InsightRange) => { setR(v); try { localStorage.setItem(RANGE_KEY, v); } catch { /* private mode */ } }];
}

export interface Envelope {
  range: InsightRange; since: string; until: string; days: number; previous: { since: string; until: string };
  instagram_username: string | null; page_name: string | null;
  missing: { what: string; why: string }[]; at: string;
}

export function useInsights<T>(part: 'overview' | 'posts' | 'audience', range: InsightRange) {
  const [data, setData] = useState<(T & Envelope) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (fresh = false) => {
    setLoading(true); setError(null);
    try { setData(await api<T & Envelope>(`/api/insights?part=${part}&range=${range}${fresh ? '&fresh=1' : ''}`)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [part, range]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

export function InsightRangePicker({ value, onChange }: { value: InsightRange; onChange: (r: InsightRange) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      {INSIGHT_RANGES.map(r => (
        <button key={r.key} type="button" onClick={() => onChange(r.key)}
          className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap min-h-0', value === r.key ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

/** Against the period before: up green, down red; `invert` for numbers where down is good (unfollows). */
export function Delta({ now, before, invert }: { now: number | null | undefined; before: number | null | undefined; invert?: boolean }) {
  if (now === null || now === undefined || !before) return null;
  const d = ((now - before) / before) * 100;
  if (Math.abs(d) < 0.5) return <span className="text-[11px] text-muted-foreground">same as before</span>;
  const up = d > 0, good = invert ? !up : up;
  // Past tripling a percentage stops reading ("1,700%"); say how many times instead.
  const text = up && now / before >= 3 ? `${now / before >= 10 ? Math.round(now / before) : (now / before).toFixed(1)}×` : `${Math.abs(d).toFixed(0)}%`;
  return <span className={cn('inline-flex items-center text-[11px] font-medium', good ? 'text-success' : 'text-destructive')}>{up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{text}</span>;
}

export function Tile({ label, value, sub, delta, title }: { label: string; value: string; sub?: React.ReactNode; delta?: React.ReactNode; title?: string }) {
  return (
    <div className="rounded-xl border p-3 min-w-0" title={title}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      <p className="text-xl md:text-2xl font-semibold tabular-nums leading-tight mt-0.5 truncate">{value}</p>
      <div className="flex items-center gap-1.5 min-h-[1rem]">{delta}{sub && <span className="text-[11px] text-muted-foreground truncate">{sub}</span>}</div>
    </div>
  );
}

/** Shares as thin bars, one hue; the number beside each (never colour alone). */
export function ShareBars({ title, rows, empty, note }: { title: string; rows: { key: string; label: string; value: number; share: number }[]; empty?: string; note?: string }) {
  const max = Math.max(0.0001, ...rows.map(r => r.share));
  return (
    <div className="rounded-xl border p-3 space-y-2 min-w-0">
      <p className="text-sm font-semibold">{title}{note && <span className="font-normal text-muted-foreground text-xs"> — {note}</span>}</p>
      {!rows.length ? <p className="text-xs text-muted-foreground">{empty ?? 'Meta has nothing for this yet.'}</p> : rows.map(r => (
        <div key={r.key} className="space-y-0.5" title={`${r.label}: ${r.value.toLocaleString('en-US')} (${Math.round(r.share * 100)}%)`}>
          <div className="flex justify-between gap-2 text-xs"><span className="truncate min-w-0">{r.label}</span><span className="tabular-nums text-muted-foreground shrink-0">{Math.round(r.share * 100)}%</span></div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(r.share / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** What Meta wouldn't give, folded away — one line, opened on a tap. */
export function MissingNote({ missing }: { missing: { what: string; why: string }[] }) {
  if (!missing.length) return null;
  return (
    <details className="text-[11px] text-muted-foreground">
      <summary className="cursor-pointer">Meta didn’t answer for {missing.length} number{missing.length === 1 ? '' : 's'}</summary>
      <ul className="mt-1 space-y-0.5">{missing.map((m, i) => <li key={i}><b>{m.what}</b>: {m.why}</li>)}</ul>
    </details>
  );
}
