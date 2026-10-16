'use client';

/**
 * Ads → A/B tests: Meta's split test. Two to five ad sets run against each other with their audiences kept
 * apart, so the difference in cost per result is the ad sets' and not chance overlap. Made here, read here
 * (each side's spend, results and cost per result so far); Meta's verdict with its confidence is in Ads
 * Manager's Experiments.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { FlaskConical, Loader2, RefreshCw, ExternalLink, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS } from '@/lib/store-config';
import { count, money, roasText } from '@/lib/ads/shape';
import { studyProblems } from '@/lib/ads/study';
import { api, useAdsStatus, NotReady, ErrorLine } from '../ads-kit';

interface Cell { name: string; share: number | null; adsets: { id: string; name: string }[]; spend: number; result: number; resultLabel: string; costPerResult: number | null; purchases: number; roas: number | null }
interface Test { id: string; name: string; start: string | null; end: string | null; running: boolean; cells: Cell[]; ahead: string | null }
interface Data { currency: string; tests: Test[]; adsets: { id: string; name: string; campaign: string; status: string }[] }

export default function TestsRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t run Meta ads from the ERP.</p>;
  return <Tests />;
}

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '—');

function Tests() {
  const { toast } = useToast();
  const { status, error: statusError, loading: statusLoading, reload, ready } = useAdsStatus();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [start, setStart] = useState(() => local(new Date(Date.now() + 15 * 60_000)));
  const [end, setEnd] = useState(() => local(new Date(Date.now() + 7 * 86_400_000)));
  const [purchases, setPurchases] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api<Data>('/api/ads/tests')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const input = { name, adsetIds: picked, start: new Date(start).toISOString(), end: new Date(end).toISOString(), purchases, pixelId: status?.settings?.pixelId ?? null };
  const problems = useMemo(() => studyProblems(input), [name, picked, start, end, purchases]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = data?.currency ?? 'PKR';
  const shown = (data?.adsets ?? []).filter(a => !filter.trim() || `${a.name} ${a.campaign}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= 5 ? p : [...p, id]));

  const make = async () => {
    setBusy(true);
    try {
      await api('/api/ads/tests', { body: input });
      toast({ title: 'Test made', description: 'Meta keeps the audiences apart from the start time.' });
      setName(''); setPicked([]); await load();
    } catch (e) { toast({ title: 'Meta didn’t take that', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  return (
    <PageShell title="A/B tests" icon={<FlaskConical className="h-7 w-7" />} width="narrow"
      action={ready ? <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Refresh</Button> : undefined}>
      {!ready ? <NotReady status={status} error={statusError} loading={statusLoading} onRetry={reload} /> : (
        <div className="space-y-3">
          {error && <ErrorLine error={error} onRetry={load} />}

          <section className="rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold">A new test</h2>
            <p className="text-sm text-muted-foreground">Make the versions first (Ad sets → copy, then change one thing: the picture, the audience or the words). Choose them here; Meta splits the people so nobody sees both.</p>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Name, like “Packshot vs on-hand”" className="h-11 text-base sm:text-sm" />
            <Input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find an ad set" className="h-9 text-base sm:text-sm" />
            <ul className="max-h-64 overflow-y-auto divide-y rounded-lg border">
              {!data && loading && <li className="p-3 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading…</li>}
              {shown.map(a => {
                const i = picked.indexOf(a.id);
                return (
                  <li key={a.id}><button type="button" onClick={() => toggle(a.id)} className={cn('w-full text-left px-3 py-2 flex items-center gap-2', i >= 0 && 'bg-primary/5')}>
                    <span className={cn('h-6 w-6 shrink-0 rounded-full border text-xs font-semibold grid place-items-center', i >= 0 ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>{i >= 0 ? String.fromCharCode(65 + i) : ''}</span>
                    <span className="min-w-0"><span className="block text-sm truncate">{a.name}</span><span className="block text-[11px] text-muted-foreground truncate">{a.campaign} · {a.status.toLowerCase().replace(/_/g, ' ')}</span></span>
                  </button></li>
                );
              })}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground space-y-1">Starts<Input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className="h-11 text-base sm:text-sm" /></label>
              <label className="text-xs text-muted-foreground space-y-1">Ends<Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className="h-11 text-base sm:text-sm" /></label>
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>Judge on website purchases<span className="block text-[11px] text-muted-foreground">Otherwise each ad set’s own result (chats, visits…).</span></span>
              <Switch checked={purchases} onCheckedChange={setPurchases} aria-label="Judge on purchases" />
            </label>
            {problems.length > 0 && <p className="text-xs text-muted-foreground">{problems[0]}</p>}
            <Button className="w-full h-11" disabled={busy || problems.length > 0} onClick={make}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Start the test</Button>
          </section>

          <section className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">Tests</h2>
              {status?.settings?.adAccountId && <a className="text-xs text-primary inline-flex items-center gap-1" href={`https://adsmanager.facebook.com/adsmanager/manage/experiments?act=${status.settings.adAccountId.replace(/^act_/, '')}`} target="_blank" rel="noopener">Meta’s verdict <ExternalLink className="h-3 w-3" /></a>}
            </div>
            {data && !data.tests.length && <p className="text-sm text-muted-foreground">None yet.</p>}
            {(data?.tests ?? []).map(t => (
              <div key={t.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <span className="text-[11px] text-muted-foreground shrink-0">{fmt(t.start)} – {fmt(t.end)}{t.running ? ' · running' : ''}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs tabular-nums">
                    <thead><tr className="text-muted-foreground text-left"><th className="font-normal py-1">Side</th><th className="font-normal text-right">Spent</th><th className="font-normal text-right">{t.cells[0]?.resultLabel ?? 'Results'}</th><th className="font-normal text-right">Per result</th><th className="font-normal text-right">ROAS</th></tr></thead>
                    <tbody>
                      {t.cells.map(c => (
                        <tr key={c.name} className="border-t">
                          <td className="py-1.5 pr-2"><span className="font-semibold">{c.name}</span>{t.ahead === c.name && <Trophy className="inline h-3 w-3 ml-1 text-amber-500" aria-label="Ahead" />}<span className="block text-[11px] text-muted-foreground truncate max-w-[11rem]">{c.adsets.map(a => a.name).join(', ')}</span></td>
                          <td className="text-right">{money(c.spend, cur)}</td>
                          <td className="text-right">{count(c.result)}</td>
                          <td className="text-right">{c.costPerResult === null ? '—' : money(c.costPerResult, cur)}</td>
                          <td className="text-right">{roasText(c.roas)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {t.ahead && <p className="text-[11px] text-muted-foreground">{t.ahead} is ahead on cost per result so far. Give it the full run before deciding; Meta’s verdict says how sure it is.</p>}
              </div>
            ))}
          </section>
        </div>
      )}
    </PageShell>
  );
}
