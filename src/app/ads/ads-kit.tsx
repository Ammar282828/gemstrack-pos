'use client';

/**
 * What every Ads page shares: calling the /api/ads routes, this house's Meta
 * status, the range picker, status pills, and the panel shown instead of a page
 * that can't work yet (not connected, no ad account chosen).
 */

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Loader2, PlugZap, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RANGES, statusOf, ACCOUNT_STATUS, type RangeKey, type Tone, type AdsAccount } from '@/lib/ads/shape';
import type { AdsSettings } from '@/lib/ads/settings';

export async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: number | null) { super(message); }
}

/** JSON in, JSON out, Meta's words on failure. */
export async function api<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = await authHeaders();
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) { body = JSON.stringify(init.body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, cache: 'no-store' });
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) throw new ApiError('Sign in to the POS to use the Ads pages.', 401);
  if (!res.ok) throw new ApiError(d.error || `The server answered ${res.status}.`, res.status, d.code);
  return d as T;
}

export interface AdsStatus {
  app: {
    id: string | null; secret: boolean; secretName: string; secretUrl: string;
    tokenSecret: string; tokenStore: { exists: boolean; read: boolean; write: boolean }; tokenStoreUrl: string;
    project: string; redirectUri: string; version: string;
  };
  connection: null | {
    connected: boolean; kind: 'user' | 'system'; userName: string | null; connectedAt: string | null;
    expiresAt: string | null; daysLeft: number | null; scopes: string[]; missingScopes: string[]; error: string | null;
  };
  connectionError: string | null;
  settings: AdsSettings | null;
  houseInstagram: string | null;
  pinnedAccount: boolean;
  account: AdsAccount | null;
  accountError: string | null;
}

export function useAdsStatus() {
  const [status, setStatus] = useState<AdsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setStatus(await api<AdsStatus>('/api/ads/status')); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const ready = !!status?.connection?.connected && !!status?.settings?.adAccountId;
  return { status, error, loading, reload: load, ready };
}

const RANGE_KEY = 'taheri_ads_range';
/** The range, remembered on this device. */
export function useRange(fallback: RangeKey = 'last_7d'): [RangeKey, (r: RangeKey) => void] {
  const [r, setR] = useState<RangeKey>(fallback);
  useEffect(() => {
    try { const v = localStorage.getItem(RANGE_KEY); if (v && RANGES.some(x => x.key === v)) setR(v as RangeKey); } catch { /* private mode */ }
  }, []);
  const set = (v: RangeKey) => { setR(v); try { localStorage.setItem(RANGE_KEY, v); } catch { /* private mode */ } };
  return [r, set];
}

export function RangePicker({ value, onChange, className }: { value: RangeKey; onChange: (r: RangeKey) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1', className)}>
      {RANGES.map(r => (
        <button key={r.key} type="button" onClick={() => onChange(r.key)}
          className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap min-h-0', value === r.key ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

export const toneClass: Record<Tone, string> = {
  good: 'bg-success/15 text-success border-success/30',
  idle: 'bg-muted text-muted-foreground border-border',
  warn: 'bg-warning/15 text-warning-foreground border-warning/40 dark:text-warning',
  bad: 'bg-destructive/10 text-destructive border-destructive/30',
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const s = statusOf(status);
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', toneClass[s.tone], className)}>
    <span className={cn('h-1.5 w-1.5 rounded-full', s.tone === 'good' ? 'bg-success' : s.tone === 'bad' ? 'bg-destructive' : s.tone === 'warn' ? 'bg-warning' : 'bg-muted-foreground/60')} />
    {s.label}
  </span>;
}

export function AccountPill({ account }: { account: AdsAccount }) {
  const s = ACCOUNT_STATUS[account.status] ?? { label: `Status ${account.status}`, tone: 'idle' as Tone };
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', toneClass[s.tone])}>{s.label}</span>;
}

/** Instead of a page that can't work yet: what's missing, and the way to Setup. */
export function NotReady({ status, error, loading, onRetry }: { status: AdsStatus | null; error: string | null; loading: boolean; onRetry: () => void }) {
  if (loading && !status) return <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Checking the Meta connection…</div>;
  if (error) return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm space-y-2">
      <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-destructive" /> {error}</p>
      <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again</Button>
    </div>
  );
  const conn = status?.connection;
  const title = !status?.app.id || !status.app.secret ? 'Meta ads aren’t set up for this shop yet'
    : !conn ? 'Connect the shop’s Meta ad account'
    : !conn.connected ? 'The Meta connection needs renewing'
    : 'Choose the ad account for this shop';
  const detail = !status?.app.id || !status.app.secret ? 'A couple of one-time steps on the Setup tab, then one tap to connect.'
    : !conn ? 'One tap on the Setup tab: log in to Facebook as the person who runs the ads and approve.'
    : !conn.connected ? (conn.error || 'Connect again on the Setup tab.')
    : 'Pick the ad account, Page and Instagram account on the Setup tab.';
  return (
    <div className="rounded-xl border-2 border-dashed p-6 md:p-10 text-center space-y-3 max-w-xl mx-auto">
      <PlugZap className="h-8 w-8 mx-auto text-muted-foreground" />
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
      <Button asChild className="h-11"><Link href="/ads/setup">Open Setup</Link></Button>
    </div>
  );
}

/** A banner for the account's own trouble (payment due, disabled…) and a login running out. */
export function AccountAlerts({ status }: { status: AdsStatus }) {
  const a = status.account;
  const s = a ? ACCOUNT_STATUS[a.status] : null;
  const days = status.connection?.daysLeft;
  const items: { tone: Tone; text: React.ReactNode }[] = [];
  if (a && s && s.tone !== 'good') items.push({ tone: s.tone, text: <><b>{a.name}: {s.label}.</b> {s.fix ?? ''}</> });
  if (a?.spendCap && a.amountSpent >= a.spendCap * 0.9) items.push({ tone: 'warn', text: <>The account has spent {Math.round((a.amountSpent / a.spendCap) * 100)}% of its spending limit. Ads stop when it reaches it — raise it in Ads Manager → Payment settings.</> });
  if (days !== null && days !== undefined && days <= 10) items.push({ tone: days <= 3 ? 'bad' : 'warn', text: <>The Meta connection runs out in {days <= 0 ? 'less than a day' : `${days} day${days === 1 ? '' : 's'}`}. <Link href="/ads/setup" className="underline">Connect again</Link> to keep the Ads pages working (running ads are not affected).</> });
  if (status.accountError) items.push({ tone: 'bad', text: <>Meta didn’t answer for the ad account: {status.accountError}</> });
  if (!items.length) return null;
  return <div className="space-y-2">{items.map((it, i) => (
    <div key={i} className={cn('rounded-lg border p-3 text-sm flex gap-2', it.tone === 'bad' ? 'border-destructive/40 bg-destructive/5' : 'border-warning/50 bg-warning/10')}>
      <AlertTriangle className={cn('h-4 w-4 shrink-0 mt-0.5', it.tone === 'bad' ? 'text-destructive' : 'text-warning')} /><div>{it.text}</div>
    </div>
  ))}</div>;
}

export function ErrorLine({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{error}{onRetry && <button type="button" className="text-primary ml-2 min-h-0" onClick={onRetry}>Try again</button>}</div>;
}
