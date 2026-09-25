'use client';

/**
 * Ads → Campaigns: every campaign, its ad sets and their ads, with the range's
 * numbers — and everything that can be done to them from a phone: run / pause
 * (a switch), budget, end date, audience, rename, duplicate, archive, delete,
 * and each ad's preview as Instagram will show it, with Meta's review notes.
 *
 * `?ad=<id>` opens that ad (the Overview's links land here).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AmountInput } from '@/components/ui/amount-input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { FolderKanban, Plus, RefreshCw, Loader2, ChevronRight, MoreVertical, Pencil, Wallet, CalendarClock, Copy, Archive, Trash2, Users, Eye, ExternalLink, Search, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS } from '@/lib/store-config';
import {
  money, count, compact, resultOf, objectiveLabel, RESULT_FOR_GOAL, sumMetrics,
  type Metrics, type RangeKey, type AdsAccount, type TreeCampaign, type TreeAdSet, type TreeAd, type Level,
} from '@/lib/ads/shape';
import { parseTargeting, describeAudience, type AudienceDraft } from '@/lib/ads/targeting';
import { api, useAdsStatus, useRange, RangePicker, NotReady, AccountAlerts, ErrorLine, StatusPill } from '../ads-kit';
import { AudienceEditor } from '../audience-editor';

export default function CampaignsRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t run Meta ads from the POS.</p>;
  return <Suspense fallback={null}><Campaigns /></Suspense>;
}

type Filter = 'all' | 'running' | 'paused' | 'problems';
type Target = { level: Level; id: string; name: string; status: string; dailyBudget?: number | null; lifetimeBudget?: number | null; end?: string | null };
type Dialogs =
  | { kind: 'budget'; t: Target }
  | { kind: 'rename'; t: Target }
  | { kind: 'schedule'; t: Target }
  | { kind: 'audience'; t: Target }
  | { kind: 'ad'; id: string }
  | { kind: 'confirm'; t: Target; action: 'archive' | 'delete' | 'duplicate' | 'activate' }
  | null;

const running = (s: string) => s === 'ACTIVE';
const problem = (s: string, issues: string[]) => ['DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO'].includes(s) || issues.length > 0;
const LEVEL_WORD: Record<Level, string> = { campaign: 'campaign', adset: 'ad set', ad: 'ad' };

function Numbers({ m, goal, cur, className }: { m: Metrics; goal?: string; cur: string; className?: string }) {
  const r = resultOf(m, goal);
  return (
    <span className={cn('text-[11px] text-muted-foreground tabular-nums', className)}>
      <b className="text-foreground font-semibold">{money(m.spend, cur)}</b>
      {r ? <> · {count(r.value)} {r.label.toLowerCase()}{r.value ? ` · ${money(m.spend / r.value, cur, { cents: true })} each` : ''}</> : null}
      {' · '}{compact(m.reach)} reached
    </span>
  );
}

function budgetText(daily: number | null | undefined, lifetime: number | null | undefined, cur: string) {
  if (daily) return `${money(daily, cur)} a day`;
  if (lifetime) return `${money(lifetime, cur)} in total`;
  return null;
}

function Campaigns() {
  const { toast } = useToast();
  const params = useSearchParams();
  const { status, error: statusError, loading: statusLoading, reload, ready } = useAdsStatus();
  const [range, setRange] = useRange();
  const [data, setData] = useState<{ account: AdsAccount; campaigns: TreeCampaign[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [archived, setArchived] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api(`/api/ads/campaigns?range=${range}${archived ? '&archived=1' : ''}`)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [range, archived]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  // ?ad= — open its campaign and ad set, and the ad itself.
  useEffect(() => {
    const id = params.get('ad');
    if (!id || !data) return;
    for (const c of data.campaigns) for (const s of c.adsets) if (s.ads.some(a => a.id === id)) setOpen(o => ({ ...o, [c.id]: true, [s.id]: true }));
    setDialog({ kind: 'ad', id });
  }, [params, data]);

  const cur = data?.account.currency ?? 'PKR';

  const act = async (t: Target, body: Record<string, unknown>, done: string) => {
    setBusy(t.id);
    try {
      await api(`/api/ads/object/${t.id}`, { body: { level: t.level, ...body } });
      toast({ title: done });
      await load();
      return true;
    } catch (e) {
      toast({ title: 'Meta didn’t take that', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      return false;
    } finally { setBusy(null); }
  };
  const toggle = (t: Target, on: boolean) => {
    if (on) setDialog({ kind: 'confirm', t, action: 'activate' });
    else act(t, { action: 'status', status: 'PAUSED' }, `Paused ${t.name}`);
  };

  const campaigns = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (data?.campaigns ?? []).filter(c => {
      const text = [c.name, ...c.adsets.map(s => s.name), ...c.adsets.flatMap(s => s.ads.map(a => a.name))].join(' ').toLowerCase();
      if (!words.every(w => text.includes(w))) return false;
      const states = [c, ...c.adsets, ...c.adsets.flatMap(s => s.ads)];
      if (filter === 'running') return running(c.effectiveStatus);
      if (filter === 'paused') return c.effectiveStatus === 'PAUSED';
      if (filter === 'problems') return states.some(x => problem(x.effectiveStatus, x.issues));
      return true;
    });
  }, [data, filter, q]);
  const shownTotal = useMemo(() => sumMetrics(campaigns.map(c => c.metrics)), [campaigns]);

  const Menu = ({ t, budget, schedule, audience }: { t: Target; budget?: boolean; schedule?: boolean; audience?: boolean }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 min-h-0 shrink-0" aria-label="More" disabled={busy === t.id}>{busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {t.level === 'ad' && <DropdownMenuItem onSelect={() => setDialog({ kind: 'ad', id: t.id })}><Eye className="h-4 w-4 mr-2" /> Preview and review notes</DropdownMenuItem>}
        {budget && <DropdownMenuItem onSelect={() => setDialog({ kind: 'budget', t })}><Wallet className="h-4 w-4 mr-2" /> Change budget</DropdownMenuItem>}
        {schedule && <DropdownMenuItem onSelect={() => setDialog({ kind: 'schedule', t })}><CalendarClock className="h-4 w-4 mr-2" /> End date</DropdownMenuItem>}
        {audience && <DropdownMenuItem onSelect={() => setDialog({ kind: 'audience', t })}><Users className="h-4 w-4 mr-2" /> Audience and placements</DropdownMenuItem>}
        <DropdownMenuItem onSelect={() => setDialog({ kind: 'rename', t })}><Pencil className="h-4 w-4 mr-2" /> Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setDialog({ kind: 'confirm', t, action: 'duplicate' })}><Copy className="h-4 w-4 mr-2" /> Duplicate (paused)</DropdownMenuItem>
        <DropdownMenuSeparator />
        {t.status !== 'ARCHIVED' && <DropdownMenuItem onSelect={() => setDialog({ kind: 'confirm', t, action: 'archive' })}><Archive className="h-4 w-4 mr-2" /> Archive</DropdownMenuItem>}
        <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDialog({ kind: 'confirm', t, action: 'delete' })}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const Issues = ({ list }: { list: string[] }) => list.length ? <p className="text-[11px] text-destructive flex gap-1 mt-0.5"><AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />{list.join(' · ')}</p> : null;

  const adRow = (a: TreeAd, s: TreeAdSet) => {
    const t: Target = { level: 'ad', id: a.id, name: a.name, status: a.status };
    return (
      <li key={a.id} className="flex items-center gap-2.5 py-2 pl-2">
        <button type="button" onClick={() => setDialog({ kind: 'ad', id: a.id })} className="shrink-0 min-h-0">
          {a.thumbnail ? <img src={a.thumbnail} alt="" className="h-11 w-11 rounded-md object-cover bg-muted" /> : <span className="block h-11 w-11 rounded-md bg-muted" />}
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => setDialog({ kind: 'ad', id: a.id })} className="block text-left text-sm font-medium truncate max-w-full min-h-0">{a.name}</button>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><StatusPill status={a.effectiveStatus} /><Numbers m={a.metrics} goal={s.optimizationGoal} cur={cur} /></div>
          <Issues list={a.issues} />
        </div>
        {a.instagramPermalink && <a href={a.instagramPermalink} target="_blank" rel="noopener" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open on Instagram"><ExternalLink className="h-4 w-4" /></a>}
        <Switch checked={a.status === 'ACTIVE'} disabled={busy === a.id || a.status === 'ARCHIVED'} onCheckedChange={on => toggle(t, on)} aria-label="Running" />
        <Menu t={t} />
      </li>
    );
  };

  const setRow = (s: TreeAdSet) => {
    const t: Target = { level: 'adset', id: s.id, name: s.name, status: s.status, dailyBudget: s.dailyBudget, lifetimeBudget: s.lifetimeBudget, end: s.endTime };
    const b = budgetText(s.dailyBudget, s.lifetimeBudget, cur);
    return (
      <li key={s.id} className="py-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOpen(o => ({ ...o, [s.id]: !o[s.id] }))} className="min-h-0 p-1 -ml-1 shrink-0" aria-label={open[s.id] ? 'Fold' : 'Open'}>
            <ChevronRight className={cn('h-4 w-4 transition-transform', open[s.id] && 'rotate-90')} />
          </button>
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => setOpen(o => ({ ...o, [s.id]: !o[s.id] }))} className="block text-left text-sm font-medium truncate max-w-full min-h-0">{s.name}</button>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <StatusPill status={s.effectiveStatus} />
              {s.learning && <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', s.learning === 'Learning limited' ? 'border-warning/50 text-warning' : 'text-muted-foreground')}>{s.learning}</span>}
              <span className="text-[11px] text-muted-foreground">{RESULT_FOR_GOAL[s.optimizationGoal]?.label ?? s.optimizationGoal.toLowerCase().replace(/_/g, ' ')}{b ? ` · ${b}` : ''}{s.endTime ? ` · ends ${new Date(s.endTime).toLocaleDateString()}` : ''}</span>
            </div>
            <Numbers m={s.metrics} goal={s.optimizationGoal} cur={cur} className="block" />
            <Issues list={s.issues} />
          </div>
          <Switch checked={s.status === 'ACTIVE'} disabled={busy === s.id || s.status === 'ARCHIVED'} onCheckedChange={on => toggle(t, on)} aria-label="Running" />
          <Menu t={t} budget={!!(s.dailyBudget || s.lifetimeBudget)} schedule audience />
        </div>
        {open[s.id] && (s.ads.length ? <ul className="ml-6 border-l pl-1 divide-y">{s.ads.map(a => adRow(a, s))}</ul> : <p className="ml-8 text-xs text-muted-foreground py-1">No ads in this ad set.</p>)}
      </li>
    );
  };

  return (
    <PageShell title="Campaigns" icon={<FolderKanban className="h-7 w-7" />} width="wide"
      subtitle={data ? `${data.campaigns.length} campaign${data.campaigns.length === 1 ? '' : 's'} · ${data.account.name}` : undefined}
      action={ready ? <>
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Refresh</Button>
        <Button asChild><Link href="/ads/new"><Plus className="h-4 w-4 mr-1.5" /> New ad</Link></Button>
      </> : undefined}>
      {!ready ? <NotReady status={status} error={statusError} loading={statusLoading} onRetry={reload} /> : (
        <>
          {status && <AccountAlerts status={status} />}
          <RangePicker value={range} onChange={setRange} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[12rem]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a campaign, ad set or ad" className="h-10 pl-9" />
            </div>
            <div className="inline-flex rounded-full border p-0.5 text-xs">
              {(['all', 'running', 'paused', 'problems'] as Filter[]).map(f => (
                <button key={f} type="button" onClick={() => setFilter(f)} className={cn('rounded-full px-3 py-1.5 min-h-0', filter === f ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{f === 'all' ? 'All' : f === 'running' ? 'Running' : f === 'paused' ? 'Paused' : 'Problems'}</button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={archived} onCheckedChange={setArchived} /> Archived too</label>
          </div>
          {error && <ErrorLine error={error} onRetry={load} />}
          {!data && loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Asking Meta…</div>}
          {data && (
            <>
              <p className="text-xs text-muted-foreground">{campaigns.length === data.campaigns.length ? 'All campaigns' : `${campaigns.length} of ${data.campaigns.length} campaigns`}: <b className="text-foreground">{money(shownTotal.spend, cur)}</b> spent · {compact(shownTotal.impressions)} views</p>
              {!campaigns.length && <div className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">{data.campaigns.length ? 'Nothing matches.' : <>No campaigns yet. <Link href="/ads/new" className="text-primary">Make the first ad →</Link></>}</div>}
              <ul className="space-y-2.5">
                {campaigns.map(c => {
                  const t: Target = { level: 'campaign', id: c.id, name: c.name, status: c.status, dailyBudget: c.dailyBudget, lifetimeBudget: c.lifetimeBudget, end: c.stopTime };
                  const b = budgetText(c.dailyBudget, c.lifetimeBudget, cur);
                  const goal = c.adsets.length === 1 ? c.adsets[0].optimizationGoal : undefined;
                  return (
                    <li key={c.id} className="rounded-xl border p-3">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setOpen(o => ({ ...o, [c.id]: !o[c.id] }))} className="min-h-0 p-1 -ml-1 shrink-0" aria-label={open[c.id] ? 'Fold' : 'Open'}>
                          <ChevronRight className={cn('h-4 w-4 transition-transform', open[c.id] && 'rotate-90')} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={() => setOpen(o => ({ ...o, [c.id]: !o[c.id] }))} className="block text-left font-semibold truncate max-w-full min-h-0">{c.name}</button>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <StatusPill status={c.effectiveStatus} />
                            <span className="text-[11px] text-muted-foreground">{objectiveLabel(c.objective)} · {c.adsets.length} ad set{c.adsets.length === 1 ? '' : 's'}{b ? ` · ${b}` : ''}{c.stopTime ? ` · ends ${new Date(c.stopTime).toLocaleDateString()}` : ''}</span>
                          </div>
                          <Numbers m={c.metrics} goal={goal} cur={cur} className="block" />
                          <Issues list={c.issues} />
                        </div>
                        <Switch checked={c.status === 'ACTIVE'} disabled={busy === c.id || c.status === 'ARCHIVED'} onCheckedChange={on => toggle(t, on)} aria-label="Running" />
                        <Menu t={t} budget={!!(c.dailyBudget || c.lifetimeBudget)} schedule />
                      </div>
                      {open[c.id] && (c.adsets.length ? <ul className="mt-1 ml-3 border-l pl-2 divide-y">{c.adsets.map(setRow)}</ul> : <p className="ml-8 text-xs text-muted-foreground">No ad sets.</p>)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {dialog?.kind === 'budget' && <BudgetDialog t={dialog.t} cur={cur} min={data?.account.minDailyBudget ?? null} onClose={() => setDialog(null)} onSave={body => act(dialog.t, { action: 'budget', ...body }, 'Budget changed')} />}
      {dialog?.kind === 'rename' && <RenameDialog t={dialog.t} onClose={() => setDialog(null)} onSave={name => act(dialog.t, { action: 'rename', name }, 'Renamed')} />}
      {dialog?.kind === 'schedule' && <ScheduleDialog t={dialog.t} onClose={() => setDialog(null)} onSave={end => act(dialog.t, { action: 'schedule', end }, end ? 'End date set' : 'Runs with no end date')} />}
      {dialog?.kind === 'audience' && <AudienceDialog t={dialog.t} cur={cur} onClose={() => setDialog(null)} onSave={draft => act(dialog.t, { action: 'targeting', draft }, 'Audience saved')} />}
      {dialog?.kind === 'ad' && <AdDialog id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'confirm' && (
        <AlertDialog open onOpenChange={o => { if (!o) setDialog(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{{ archive: 'Archive', delete: 'Delete', duplicate: 'Duplicate', activate: 'Run' }[dialog.action]} “{dialog.t.name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                {dialog.action === 'activate' && <>This {LEVEL_WORD[dialog.t.level]} starts spending{budgetText(dialog.t.dailyBudget, dialog.t.lifetimeBudget, cur) ? ` — ${budgetText(dialog.t.dailyBudget, dialog.t.lifetimeBudget, cur)}` : ''} as soon as Meta has reviewed it{dialog.t.level !== 'campaign' ? ' (its campaign must be running too)' : ''}.</>}
                {dialog.action === 'archive' && <>It stops and moves out of the way. Its numbers stay in Meta’s reports; an archived {LEVEL_WORD[dialog.t.level]} can’t be switched back on.</>}
                {dialog.action === 'delete' && <>It stops for good{dialog.t.level !== 'ad' ? ', with everything under it' : ''}. This can’t be undone.</>}
                {dialog.action === 'duplicate' && <>A paused copy{dialog.t.level !== 'ad' ? ', with everything under it,' : ''} appears beside it — change what you like, then switch it on.</>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Not now</AlertDialogCancel>
              <AlertDialogAction className={dialog.action === 'delete' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined} onClick={() => {
                const { t, action } = dialog; setDialog(null);
                if (action === 'activate') act(t, { action: 'status', status: 'ACTIVE' }, `${t.name} is running`);
                else act(t, { action }, action === 'duplicate' ? 'Copied — it’s paused' : action === 'archive' ? 'Archived' : 'Deleted');
              }}>{{ archive: 'Archive', delete: 'Delete', duplicate: 'Duplicate', activate: 'Run it' }[dialog.action]}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </PageShell>
  );
}

function BudgetDialog({ t, cur, min, onClose, onSave }: { t: Target; cur: string; min: number | null; onClose: () => void; onSave: (b: { daily?: number; lifetime?: number }) => Promise<boolean> }) {
  const daily = !!t.dailyBudget;
  const was = (daily ? t.dailyBudget : t.lifetimeBudget) ?? 0;
  const [v, setV] = useState<number | undefined>(was || undefined);
  const [busy, setBusy] = useState(false);
  const low = daily && min && v !== undefined && v < min;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{daily ? 'Daily budget' : 'Total budget'}</DialogTitle>
          <DialogDescription>{t.name} — now {money(was, cur)}{daily ? ' a day' : ' in total'}. Meta can spend up to 75% over on a good day and less on others; it evens out over the week.</DialogDescription>
        </DialogHeader>
        <AmountInput value={v} onValueChange={setV} className="h-12 text-lg tabular-nums" autoFocus />
        <div className="flex flex-wrap gap-1.5">
          {[-20, 20, 50, 100].map(p => (
            <Button key={p} type="button" variant="outline" size="sm" className="h-8" onClick={() => setV(Math.max(1, Math.round((was * (100 + p)) / 100)))}>{p > 0 ? '+' : ''}{p}%</Button>
          ))}
        </div>
        {low && <p className="text-xs text-destructive">Meta’s minimum for this account is {money(min!, cur)} a day.</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !v || v <= 0 || v === was || !!low} onClick={async () => { setBusy(true); if (await onSave(daily ? { daily: v } : { lifetime: v })) onClose(); setBusy(false); }}>
            {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save {v ? money(v, cur) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ t, onClose, onSave }: { t: Target; onClose: () => void; onSave: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState(t.name);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Rename the {LEVEL_WORD[t.level]}</DialogTitle></DialogHeader>
        <Input value={name} onChange={e => setName(e.target.value)} className="h-11" autoFocus />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !name.trim() || name.trim() === t.name} onClick={async () => { setBusy(true); if (await onSave(name.trim())) onClose(); setBusy(false); }}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const localInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function ScheduleDialog({ t, onClose, onSave }: { t: Target; onClose: () => void; onSave: (end: string | null) => Promise<boolean> }) {
  const [end, setEnd] = useState(localInput(t.end));
  const [busy, setBusy] = useState(false);
  const total = !t.dailyBudget && !!t.lifetimeBudget;
  const save = async (v: string | null) => { setBusy(true); if (await onSave(v)) onClose(); setBusy(false); };
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>When it stops</DialogTitle>
          <DialogDescription>{t.name}{total ? ' has a total budget, so it needs an end date — Meta spreads the budget up to it.' : '.'}</DialogDescription>
        </DialogHeader>
        <Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className="h-11" min={localInput(new Date().toISOString())} />
        <DialogFooter className="gap-2">
          {!total && t.end && <Button variant="outline" disabled={busy} onClick={() => save(null)}>No end date</Button>}
          <Button disabled={busy || !end} onClick={() => save(new Date(end).toISOString())}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AudienceDialog({ t, cur, onClose, onSave }: { t: Target; cur: string; onClose: () => void; onSave: (d: AudienceDraft) => Promise<boolean> }) {
  const [draft, setDraft] = useState<AudienceDraft | null>(null);
  const [goal, setGoal] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ adset: { targeting?: Record<string, unknown>; optimization_goal?: string } }>(`/api/ads/object/${t.id}?level=adset`)
      .then(d => { setDraft(parseTargeting(d.adset.targeting)); setGoal(d.adset.optimization_goal); })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [t.id]);
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Audience — {t.name}</DialogTitle>
          <DialogDescription>{draft ? describeAudience(draft) : 'Reading it from Meta…'}</DialogDescription>
        </DialogHeader>
        {error && <ErrorLine error={error} />}
        {!draft && !error && <Loader2 className="h-5 w-5 animate-spin mx-auto my-6 text-muted-foreground" />}
        {draft && <AudienceEditor draft={draft} onChange={setDraft} goal={goal} currency={cur} />}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !draft} onClick={async () => { setBusy(true); if (draft && await onSave(draft)) onClose(); setBusy(false); }}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />} Save the audience</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const FORMAT_LABEL: Record<string, string> = { INSTAGRAM_STANDARD: 'Instagram feed', INSTAGRAM_STORY: 'Story', INSTAGRAM_REELS: 'Reels', MOBILE_FEED_STANDARD: 'Facebook feed' };

/** Meta's preview snippet is an <iframe> of facebook.com; only its address is used, in a frame of ours. */
function previewSrc(html: string): string | null {
  const m = html.match(/src="([^"]+)"/);
  if (!m) return null;
  const src = m[1].replace(/&amp;/g, '&');
  try { const u = new URL(src); return /(^|\.)facebook\.com$/.test(u.hostname) ? src : null; } catch { return null; }
}

function AdDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<{ ad: Record<string, unknown>; previews: { format: string; html: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fmt, setFmt] = useState(0);
  useEffect(() => {
    api<{ ad: Record<string, unknown>; previews: { format: string; html: string }[] }>(`/api/ads/object/${id}?level=ad`).then(setD).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);
  const ad = d?.ad as { name?: string; effective_status?: string; created_time?: string; ad_review_feedback?: { global?: Record<string, string> }; issues_info?: { error_summary?: string; error_message?: string }[]; creative?: { body?: string; title?: string; instagram_permalink_url?: string; call_to_action_type?: string }; adset?: { name?: string } } | undefined;
  const feedback = Object.entries(ad?.ad_review_feedback?.global ?? {});
  const src = d?.previews[fmt] ? previewSrc(d.previews[fmt].html) : null;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{ad?.name ?? 'The ad'}</DialogTitle>
          <DialogDescription asChild><div className="flex flex-wrap items-center gap-2">{ad?.effective_status && <StatusPill status={ad.effective_status} />}{ad?.adset?.name && <span className="text-xs">in {ad.adset.name}</span>}</div></DialogDescription>
        </DialogHeader>
        {error && <ErrorLine error={error} />}
        {!d && !error && <Loader2 className="h-5 w-5 animate-spin mx-auto my-6 text-muted-foreground" />}
        {d && (
          <div className="space-y-3">
            {(feedback.length > 0 || (ad?.issues_info ?? []).length > 0) && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
                <p className="font-medium">Meta’s notes</p>
                {feedback.map(([k, v]) => <p key={k} className="text-xs">{v || k}</p>)}
                {(ad?.issues_info ?? []).map((i, n) => <p key={n} className="text-xs">{i.error_summary}{i.error_message && i.error_message !== i.error_summary ? ` — ${i.error_message}` : ''}</p>)}
                {feedback.length > 0 && <p className="text-xs text-muted-foreground">Fix the ad (a new ad with different words or photo is often quickest), or ask Meta for another review in Account Quality.</p>}
              </div>
            )}
            {d.previews.length > 0 ? (
              <>
                <div className="inline-flex rounded-full border p-0.5 text-xs">
                  {d.previews.map((p, i) => <button key={p.format} type="button" onClick={() => setFmt(i)} className={cn('rounded-full px-3 py-1.5 min-h-0', fmt === i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{FORMAT_LABEL[p.format] ?? p.format}</button>)}
                </div>
                {src ? <iframe key={src} src={src} title="Ad preview" className="w-full h-[560px] rounded-lg border bg-white" sandbox="allow-scripts allow-same-origin allow-popups" /> : <p className="text-xs text-muted-foreground">Meta sent a preview this page can’t show.</p>}
              </>
            ) : <p className="text-sm text-muted-foreground">Meta has no preview for this ad.</p>}
            {ad?.creative?.body && <p className="text-sm whitespace-pre-line rounded-lg bg-muted/50 p-3">{ad.creative.body}</p>}
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {ad?.creative?.call_to_action_type && <span>Button: {ad.creative.call_to_action_type.replace(/_/g, ' ').toLowerCase()}</span>}
              {ad?.created_time && <span>Made {new Date(ad.created_time).toLocaleDateString()}</span>}
              {ad?.creative?.instagram_permalink_url && <a href={ad.creative.instagram_permalink_url} target="_blank" rel="noopener" className="text-primary inline-flex items-center gap-1">On Instagram <ExternalLink className="h-3 w-3" /></a>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

