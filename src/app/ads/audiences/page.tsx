'use client';

/**
 * Ads → Audiences: the ad account's audiences, and the three kinds worth making
 * from here — the shop's own customers (from the POS customer book, hashed on
 * the server before Meta sees them), people who engaged with the house's
 * Instagram, and lookalikes of either. Any of them can then be reached or left
 * out on New ad → Who sees it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { UsersRound, Loader2, RefreshCw, Trash2, Contact, Instagram, Sparkles, ShieldCheck, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS, STORE_CONFIG } from '@/lib/store-config';
import { compact } from '@/lib/ads/shape';
import type { Segment } from '@/lib/ads/audience-rows';
import { api, useAdsStatus, NotReady, ErrorLine } from '../ads-kit';

interface Audience { id: string; name: string; kind: string; description: string | null; size: [number, number] | null; ready: boolean; status: string | null; created: string | null; retentionDays: number | null }
interface Data { audiences: Audience[]; segments: { key: Segment; label: string; hint: string }[]; events: { key: string; label: string }[]; instagram: string | null }

export default function AudiencesRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t run Meta ads from the POS.</p>;
  return <Audiences />;
}

const COUNTRIES = [['PK', 'Pakistan'], ['AE', 'UAE'], ['SA', 'Saudi Arabia'], ['GB', 'UK'], ['US', 'USA'], ['CA', 'Canada']];

function Audiences() {
  const { toast } = useToast();
  const { status, error: statusError, loading: statusLoading, reload, ready } = useAdsStatus();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('buyers');
  const [days, setDays] = useState(365);
  const [event, setEvent] = useState('ig_business_profile_all');
  const [origin, setOrigin] = useState('');
  const [percent, setPercent] = useState(1);
  const [country, setCountry] = useState('PK');
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'customers'; a?: Audience } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api<Data>('/api/ads/audiences')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const make = async (body: Record<string, unknown>, what: string) => {
    setBusy(what);
    try {
      const d = await api<{ id?: string; sent?: number; received?: number; invalid?: number }>('/api/ads/audiences', { body });
      toast({ title: 'Audience made', description: d.sent ? `${d.sent.toLocaleString()} customers sent (hashed); Meta matches them over the next hour or so.` : 'Meta fills it over the next hour or so.' });
      await load();
    } catch (e) { toast({ title: 'Not made', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  const remove = async (a: Audience) => {
    setBusy(a.id);
    try { await api(`/api/ads/audiences?id=${a.id}`, { method: 'DELETE' }); toast({ title: 'Deleted' }); await load(); }
    catch (e) { toast({ title: 'Not deleted', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  const refresh = async (a: Audience) => {
    setBusy(a.id);
    try {
      const d = await api<{ sent: number }>('/api/ads/audiences', { body: { kind: 'refresh', id: a.id, segment } });
      toast({ title: 'Updated', description: `${d.sent.toLocaleString()} customers sent; ones Meta already had are ignored.` });
      await load();
    } catch (e) { toast({ title: 'Not updated', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };

  const seeds = (data?.audiences ?? []).filter(a => a.kind !== 'Lookalike');
  const seg = data?.segments.find(s => s.key === segment);

  return (
    <PageShell title="Audiences" icon={<UsersRound className="h-7 w-7" />} width="narrow"
      action={ready ? <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Refresh</Button> : undefined}>
      {!ready ? <NotReady status={status} error={statusError} loading={statusLoading} onRetry={reload} /> : (
        <div className="space-y-3">
          {error && <ErrorLine error={error} onRetry={load} />}

          <section className="rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><Contact className="h-5 w-5" /> {STORE_CONFIG.name}’s customers</h2>
            <p className="text-sm text-muted-foreground">Show ads to people who already buy from the shop — or leave them out of ads meant for new people. From the POS customer book: phones and emails are scrambled (SHA-256) on this server before anything goes to Meta, which only matches them to accounts.</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(data?.segments ?? []).map(s => (
                <button key={s.key} type="button" onClick={() => setSegment(s.key)} className={cn('rounded-lg border p-2.5 text-left', segment === s.key ? 'border-primary ring-1 ring-primary' : '')}>
                  <span className="block text-sm font-medium">{s.label}</span><span className="block text-[11px] text-muted-foreground">{s.hint}</span>
                </button>
              ))}
            </div>
            <Button className="w-full h-11" disabled={!!busy || !data} onClick={() => setConfirm({ kind: 'customers' })}>{busy === 'customers' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-1.5" />} Make “{seg?.label ?? 'customers'}”</Button>
          </section>

          <section className="rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><Instagram className="h-5 w-5" /> Instagram engagers{data?.instagram ? <span className="text-muted-foreground font-normal">— @{data.instagram}</span> : null}</h2>
            <p className="text-sm text-muted-foreground">People who already know the shop on Instagram — usually the cheapest to turn into chats.</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <select value={event} onChange={e => setEvent(e.target.value)} className="h-10 rounded-md border bg-background px-2 text-sm">
                {(data?.events ?? []).map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
              <select value={days} onChange={e => setDays(Number(e.target.value))} className="h-10 rounded-md border bg-background px-2 text-sm">
                {[30, 90, 180, 365, 730].map(d => <option key={d} value={d}>in the last {d === 730 ? '2 years' : d === 365 ? 'year' : `${d} days`}</option>)}
              </select>
            </div>
            <Button variant="outline" className="w-full h-11" disabled={!!busy || !data} onClick={() => make({ kind: 'engagers', days, event }, 'engagers')}>{busy === 'engagers' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Instagram className="h-4 w-4 mr-1.5" />} Make the engagers audience</Button>
          </section>

          <section className="rounded-xl border p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2"><Sparkles className="h-5 w-5" /> Lookalike</h2>
            <p className="text-sm text-muted-foreground">New people who resemble an audience above. 1% is the closest match; bigger reaches more people, less alike. Meta needs at least 100 matched people in the country to start from.</p>
            <select value={origin} onChange={e => setOrigin(e.target.value)} className="h-10 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">Like which audience?</option>
              {seeds.map(a => <option key={a.id} value={a.id}>{a.name}{a.size ? ` (${compact(a.size[0])}–${compact(a.size[1])})` : ''}</option>)}
            </select>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border p-0.5 text-xs">
                {[1, 2, 3, 5, 10].map(p => <button key={p} type="button" onClick={() => setPercent(p)} className={cn('rounded-full px-3 py-1.5 min-h-0', percent === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{p}%</button>)}
              </div>
              <select value={country} onChange={e => setCountry(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </div>
            <Button variant="outline" className="w-full h-11" disabled={!!busy || !origin} onClick={() => make({ kind: 'lookalike', origin, percent, country }, 'lookalike')}>{busy === 'lookalike' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />} Make the lookalike</Button>
          </section>

          <section className="rounded-xl border p-4 space-y-2">
            <h2 className="font-semibold">In the ad account</h2>
            {!data && loading && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading…</p>}
            {data && !data.audiences.length && <p className="text-sm text-muted-foreground">No audiences yet.</p>}
            <ul className="divide-y">
              {(data?.audiences ?? []).map(a => (
                <li key={a.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-[11px] text-muted-foreground">{a.kind}{a.size ? ` · ${compact(a.size[0])}–${compact(a.size[1])} people` : ' · size not known yet'}{a.created ? ` · ${new Date(a.created).toLocaleDateString()}` : ''}</p>
                    {a.status && <p className="text-[11px] text-warning">{a.status}</p>}
                  </div>
                  {a.kind === 'Customer list' && <Button variant="ghost" size="icon" className="h-8 w-8 min-h-0" title="Add today’s customers" disabled={!!busy} onClick={() => refresh(a)}>{busy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}</Button>}
                  <Button variant="ghost" size="icon" className="h-8 w-8 min-h-0 text-muted-foreground" title="Delete" disabled={!!busy} onClick={() => setConfirm({ kind: 'delete', a })}><Trash2 className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === 'delete' ? `Delete “${confirm.a?.name}”?` : `Send “${seg?.label}” to Meta?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'delete'
                ? 'Ads that reach or leave out this audience lose it and keep the rest of their targeting. This can’t be undone.'
                : 'The customers’ phone numbers, emails and names are scrambled on this server first; Meta receives only the scrambled codes, matches them to accounts, and doesn’t keep the unmatched ones. The first time, Meta may ask for its Custom Audience terms to be accepted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction className={confirm?.kind === 'delete' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined} onClick={() => {
              const c = confirm; setConfirm(null);
              if (c?.kind === 'delete' && c.a) remove(c.a); else make({ kind: 'customers', segment }, 'customers');
            }}>{confirm?.kind === 'delete' ? 'Delete' : 'Send'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
