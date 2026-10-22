'use client';

/**
 * Interest — which of the site's pieces people save, ask about on WhatsApp, open, and stay on.
 *
 * Counted anonymously by the house's own site (POST /api/public/events, lib/website/piece-interest.ts)
 * since 2026-10-22, the owner's ask: "which ones are saved, inquired about, looked at for the longest".
 * One list at a time, ranked, with the piece's photo and its page; the period changes every list.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Heart, Loader2, MessageCircle, Eye, Clock, RefreshCw, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Row {
  piece: string; name: string; thumb: string; url: string; collection: string;
  views: number; saves: number; unsaves: number; netSaves: number; enquiries: number;
  dwellMs: number; dwellN: number; avgDwellMs: number;
}

const LISTS = [
  { id: 'saved', label: 'Saved', icon: Heart, rank: (r: Row) => r.netSaves, show: (r: Row) => `${r.netSaves} saved` },
  { id: 'asked', label: 'Asked about', icon: MessageCircle, rank: (r: Row) => r.enquiries, show: (r: Row) => `${r.enquiries} on WhatsApp` },
  // A minimum of three looks, so one long stare doesn't top the list.
  { id: 'longest', label: 'Looked at longest', icon: Clock, rank: (r: Row) => (r.dwellN >= 3 ? r.avgDwellMs : 0), show: (r: Row) => `${secs(r.avgDwellMs)} on average · ${r.dwellN} looks` },
  { id: 'opened', label: 'Opened', icon: Eye, rank: (r: Row) => r.views, show: (r: Row) => `${r.views} opens` },
] as const;
type ListId = typeof LISTS[number]['id'];

const PERIODS = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 0, label: 'All time' }];

const secs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 1000)}s`);

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

export default function InterestPage() {
  const [days, setDays] = useState(30);
  const [list, setList] = useState<ListId>('saved');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/website/interest?days=${days}`, { headers: await authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load');
      setRows(d.pieces);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const active = LISTS.find(l => l.id === list)!;
  const ranked = useMemo(() => (rows || []).filter(r => active.rank(r) > 0).sort((a, b) => active.rank(b) - active.rank(a)).slice(0, 40), [rows, active]);
  const totals = useMemo(() => (rows || []).reduce((t, r) => ({ views: t.views + r.views, saves: t.saves + r.netSaves, asks: t.asks + r.enquiries }), { views: 0, saves: 0, asks: 0 }), [rows]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><Heart className="mr-3 h-7 w-7" /> Interest</h1>
          <p className="text-sm text-muted-foreground mt-1">What visitors to the website save, ask about on WhatsApp, open and stay on. Counted anonymously since 22 October.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} aria-label="Reload"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {PERIODS.map(p => (
          <button key={p.days} type="button" onClick={() => setDays(p.days)}
            className={cn('rounded-full px-3.5 py-1.5 text-sm border', days === p.days ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted')}>{p.label}</button>
        ))}
      </div>

      {rows && (
        <p className="text-sm text-muted-foreground">{totals.views.toLocaleString()} opens · {totals.saves.toLocaleString()} saves · {totals.asks.toLocaleString()} WhatsApp enquiries</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {LISTS.map(l => (
          <button key={l.id} type="button" onClick={() => setList(l.id)}
            className={cn('flex items-center justify-center gap-2 rounded-full px-3 py-2 text-sm border', list === l.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted')}>
            <l.icon className="h-4 w-4" /> {l.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !rows && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {rows && !ranked.length && <p className="text-sm text-muted-foreground">Nothing counted for this yet{days ? ' in this period' : ''}. It fills as people use the website.</p>}

      <ol className="space-y-2">
        {ranked.map((r, i) => (
          <li key={r.piece} className="flex items-center gap-3 rounded-[22px] bg-card p-2.5 pr-4">
            <span className="w-6 text-center text-sm text-muted-foreground tabular-nums">{i + 1}</span>
            {r.thumb ? <img src={r.thumb} alt="" className="h-14 w-14 rounded-xl object-cover bg-muted shrink-0" loading="lazy" /> : <div className="h-14 w-14 rounded-xl bg-muted shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{r.name}</p>
              <p className="text-xs text-muted-foreground truncate">{active.show(r)}{r.collection ? ` · ${r.collection}` : ''}</p>
            </div>
            {r.url && <a href={r.url} target="_blank" rel="noopener" className="text-muted-foreground hover:text-foreground" aria-label={`Open ${r.name} on the website`}><ExternalLink className="h-4 w-4" /></a>}
          </li>
        ))}
      </ol>
    </div>
  );
}
