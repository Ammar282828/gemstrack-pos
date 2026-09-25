'use client';

/**
 * Ads → Rules: watchdogs Meta runs on the ad account by itself (pause what's
 * spending with nothing to show, a daily ceiling, a warning when results get
 * expensive), and the log of every change made to the ads from this POS.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { AmountInput } from '@/components/ui/amount-input';
import { useToast } from '@/hooks/use-toast';
import { ShieldAlert, Loader2, RefreshCw, Trash2, History, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS } from '@/lib/store-config';
import { money } from '@/lib/ads/shape';
import type { RuleKind } from '@/lib/ads/rules';
import { api, useAdsStatus, NotReady, ErrorLine } from '../ads-kit';

interface Rule { id: string; name: string; enabled: boolean; summary: string; created: string | null }
interface LogRow { id: string; at: string; by: string; action: string; target?: string; name?: string; detail?: Record<string, unknown> }
interface Data { rules: Rule[]; kinds: { key: RuleKind; label: string; hint: string; needs: 'spend' | 'cost' }[]; currency: string; log: LogRow[] }

export default function RulesRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t run Meta ads from the POS.</p>;
  return <Rules />;
}

function logLine(r: LogRow, currency: string): string {
  const d = r.detail ?? {};
  const amount = (v: unknown) => (typeof v === 'number' ? money(v, String(d.currency ?? currency)) : '');
  if (r.action === 'budget') return `budget → ${d.daily ? `${amount(d.daily)} a day` : `${amount(d.lifetime)} in total`}`;
  if (r.action === 'rename') return `renamed “${String(d.name ?? '')}”`;
  if (r.action === 'schedule') return d.end ? `end date ${new Date(String(d.end)).toLocaleDateString()}` : 'no end date';
  return r.action;
}

function Rules() {
  const { toast } = useToast();
  const { status, error: statusError, loading: statusLoading, reload, ready } = useAdsStatus();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState<RuleKind>('notify_no_results');
  const [amount, setAmount] = useState<number | undefined>(500);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api<Data>('/api/ads/rules')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try { await fn(); toast({ title: done }); await load(); }
    catch (e) { toast({ title: 'Meta didn’t take that', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  const cur = data?.currency ?? 'PKR';
  const chosen = data?.kinds.find(k => k.key === kind);

  return (
    <PageShell title="Rules" icon={<ShieldAlert className="h-7 w-7" />} width="narrow"
      action={ready ? <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Refresh</Button> : undefined}>
      {!ready ? <NotReady status={status} error={statusError} loading={statusLoading} onRetry={reload} /> : (
        <div className="space-y-3">
          {error && <ErrorLine error={error} onRetry={load} />}

          <section className="rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><Plus className="h-5 w-5" /> A new rule</h2>
            <p className="text-sm text-muted-foreground">Meta checks these itself around the clock and acts on every ad set in the account — the POS doesn’t need to be open.</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(data?.kinds ?? []).map(k => (
                <button key={k.key} type="button" onClick={() => setKind(k.key)} className={cn('rounded-lg border p-2.5 text-left', kind === k.key ? 'border-primary ring-1 ring-primary' : '')}>
                  <span className="block text-sm font-medium">{k.label}</span><span className="block text-[11px] text-muted-foreground">{k.hint}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <AmountInput value={amount} onValueChange={setAmount} className="h-11 max-w-[10rem] tabular-nums" aria-label="Amount" />
              <span className="text-sm text-muted-foreground">{cur}{chosen?.needs === 'cost' ? ' per result' : ' today'}</span>
            </div>
            <Button className="w-full h-11" disabled={!!busy || !amount || !data} onClick={() => run('new', () => api('/api/ads/rules', { body: { kind, amount } }), 'Rule made')}>{busy === 'new' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null} Make the rule</Button>
          </section>

          <section className="rounded-xl border p-4 space-y-2">
            <h2 className="font-semibold">Rules on the account</h2>
            {!data && loading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading…</p>}
            {data && !data.rules.length && <p className="text-sm text-muted-foreground">None yet.</p>}
            <ul className="divide-y">
              {(data?.rules ?? []).map(r => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.name}</p>
                    <p className="text-[11px] text-muted-foreground">{r.summary}</p>
                  </div>
                  <Switch checked={r.enabled} disabled={!!busy} onCheckedChange={on => run(r.id, () => api('/api/ads/rules', { body: { id: r.id, enabled: on } }), on ? 'Rule on' : 'Rule off')} aria-label="On" />
                  <Button variant="ghost" size="icon" className="h-8 w-8 min-h-0 text-muted-foreground" disabled={!!busy} onClick={() => run(r.id, () => api(`/api/ads/rules?id=${r.id}`, { method: 'DELETE' }), 'Rule deleted')} aria-label="Delete">{busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</Button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border p-4 space-y-2">
            <h2 className="font-semibold flex items-center gap-2"><History className="h-5 w-5" /> Changes made from the POS</h2>
            {data && !data.log.length && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            <ul className="divide-y">
              {(data?.log ?? []).map(r => (
                <li key={r.id} className="py-1.5 text-xs">
                  <span className="text-muted-foreground tabular-nums">{new Date(r.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  {' · '}<b>{logLine(r, cur)}</b>{r.name ? ` — ${r.name}` : r.target ? ` — ${r.target}` : ''}
                  <span className="text-muted-foreground"> · {r.by}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </PageShell>
  );
}
