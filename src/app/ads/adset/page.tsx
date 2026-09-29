'use client';

/**
 * Ad sets (lib/ads/adset-design.ts): design one or several ad sets — audience, places, budget, dates and goal
 * each — into a campaign the account has or a new one, and fill them with copies of ads already made or a
 * boosted post. Opened from Campaigns ("Add an ad set", "Copy and change") and after a new ad.
 */

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AmountInput } from '@/components/ui/amount-input';
import { Layers, Plus, Trash2, Loader2, CheckCircle2, ChevronDown, ChevronUp, Search, Check, Instagram, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS } from '@/lib/store-config';
import { GOALS, goalOf, goesToSite } from '@/lib/ads/plan';
import { describeAudience } from '@/lib/ads/targeting';
import { adCount, designProblems, goalsForObjective, nextAdSet, type AdSetDesign, type AdSetDraft } from '@/lib/ads/adset-design';
import { objectiveLabel, type TreeCampaign } from '@/lib/ads/shape';
import { api, useAdsStatus, NotReady, ErrorLine } from '../ads-kit';
import { AudienceEditor } from '../audience-editor';

export default function AdSetRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t run Meta ads from the ERP.</p>;
  return <Suspense fallback={null}><AdSetDesigner /></Suspense>;
}

interface CampaignInfo { id: string; name: string; objective: string; budgeted: boolean }
interface Media { id: string; caption: string; thumb: string | null; boostable: boolean | null }
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function AdSetDesigner() {
  const params = useSearchParams();
  const { status, error: statusError, loading: statusLoading, reload, ready } = useAdsStatus();
  const [tree, setTree] = useState<TreeCampaign[] | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ currency: string; minDaily: number | null; pixelId: string | null } | null>(null);
  const [target, setTarget] = useState<string>(params.get('campaign') || 'new');
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [sets, setSets] = useState<AdSetDraft[]>([nextAdSet(null, 1)]);
  const [open, setOpen] = useState<string | null>(null);
  const [adsKind, setAdsKind] = useState<'copy' | 'post'>('copy');
  const [adIds, setAdIds] = useState<string[]>((params.get('ads') || '').split(',').filter(x => /^\d+$/.test(x)));
  const [adQ, setAdQ] = useState('');
  const [media, setMedia] = useState<Media[] | null>(null);
  const [post, setPost] = useState<string>('');
  const [link, setLink] = useState('');
  const [launch, setLaunch] = useState<'paused' | 'live'>('paused');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ campaignId: string; adsets: { id: string; name: string; ads: string[] }[]; live: boolean; warnings: string[] } | null>(null);

  // Every ad in the account, to copy from (the last 30 days' numbers beside each).
  useEffect(() => {
    if (!ready || tree) return;
    api<{ campaigns: TreeCampaign[] }>('/api/ads/campaigns?range=last_30d').then(d => setTree(d.campaigns)).catch(e => setTreeError(e instanceof Error ? e.message : String(e)));
  }, [ready, tree]);

  // Starting from an ad set ("Copy and change"): its audience, budget and goal, its ads, its campaign.
  useEffect(() => {
    if (!ready) return;
    const from = params.get('from');
    api<{ campaign: CampaignInfo | null; draft?: Omit<AdSetDraft, 'key'>; ads?: string[]; currency: string; minDaily: number | null; pixelId: string | null }>(
      from ? `/api/ads/adsets?from=${from}` : `/api/ads/adsets${target !== 'new' ? `?campaign=${target}` : ''}`,
    ).then(d => {
      setInfo({ currency: d.currency, minDaily: d.minDaily, pixelId: d.pixelId });
      if (from && d.draft) {
        setSets([{ ...d.draft, key: 's1-from' }]);
        setOpen('s1-from');
        if (d.ads?.length) setAdIds(d.ads);
        if (d.campaign) { setTarget(d.campaign.id); setCampaign(d.campaign); }
      } else setCampaign(d.campaign);
    }).catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickCampaign = (id: string) => {
    setTarget(id);
    if (id === 'new') { setCampaign(null); return; }
    const c = tree?.find(x => x.id === id);
    setCampaign(c ? { id, name: c.name, objective: c.objective, budgeted: (c.dailyBudget ?? 0) > 0 || (c.lifetimeBudget ?? 0) > 0 } : null);
  };

  useEffect(() => { if (ready && adsKind === 'post' && !media) api<{ media: Media[] }>('/api/ads/media').then(d => setMedia(d.media)).catch(() => setMedia([])); }, [ready, adsKind, media]);

  const allowed = useMemo(() => {
    const base = campaign ? goalsForObjective(campaign.objective) : GOALS;
    return base.filter(g => (adsKind === 'post' ? !g.photosOnly : !g.postOnly));
  }, [campaign, adsKind]);
  // Keep every card's goal inside what the campaign allows.
  useEffect(() => {
    if (!allowed.length) return;
    setSets(ss => ss.map(s => (allowed.some(g => g.key === s.goal) ? s : { ...s, goal: allowed[0].key })));
  }, [allowed]);

  const design: AdSetDesign = {
    campaign: target === 'new' ? { kind: 'new', name: campaignName } : { kind: 'existing', id: target, objective: campaign?.objective ?? '', budgeted: !!campaign?.budgeted },
    adsets: sets,
    ads: adsKind === 'copy' ? { kind: 'copy', ids: adIds } : { kind: 'post', mediaId: post, link },
    launch,
  };
  const currency = info?.currency ?? status?.account?.currency ?? 'PKR';
  const problems = designProblems(design, {
    pageId: status?.settings?.pageId ?? null, instagramUserId: status?.settings?.instagramUserId ?? null, instagramUsername: null, whatsappGreeting: null,
    pixelId: info?.pixelId ?? status?.settings?.pixelId ?? null, currency, minDaily: info?.minDaily ?? status?.account?.minDailyBudget ?? null,
  });
  const budgeted = design.campaign.kind === 'existing' && design.campaign.budgeted;

  const allAds = useMemo(() => (tree ?? []).flatMap(c => c.adsets.flatMap(s => s.ads.map(a => ({ ...a, where: `${c.name} › ${s.name}` })))), [tree]);
  const shownAds = useMemo(() => {
    const w = adQ.toLowerCase().split(/\s+/).filter(Boolean);
    const list = allAds.filter(a => w.every(x => `${a.name} ${a.where}`.toLowerCase().includes(x)));
    return [...list.filter(a => adIds.includes(a.id)), ...list.filter(a => !adIds.includes(a.id))].slice(0, 60);
  }, [allAds, adQ, adIds]);

  const change = (key: string, patch: Partial<AdSetDraft>) => setSets(ss => ss.map(s => (s.key === key ? { ...s, ...patch } : s)));
  const add = () => { const n = nextAdSet(sets[sets.length - 1] ?? null, sets.length + 1); setSets(ss => [...ss, n]); setOpen(n.key); };

  const make = async () => {
    setBusy(true); setError(null);
    try { setMade(await api('/api/ads/adsets', { body: { design } })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <PageShell title="Ad sets" icon={<Layers className="h-7 w-7" />} width="narrow">
      {!ready ? <NotReady status={status} error={statusError} loading={statusLoading} onRetry={reload} /> : made ? (
        <div className="rounded-xl border p-6 text-center space-y-3">
          <CheckCircle2 className="h-10 w-10 mx-auto text-success" />
          <p className="text-lg font-semibold">{made.adsets.length} ad set{made.adsets.length === 1 ? '' : 's'} made{made.live ? '' : ' — paused'}</p>
          <ul className="text-sm text-muted-foreground">{made.adsets.map(s => <li key={s.id}>{s.name} · {s.ads.length} ad{s.ads.length === 1 ? '' : 's'}</li>)}</ul>
          {made.warnings.map((w, i) => <p key={i} className="text-xs text-warning">{w}</p>)}
          <Button asChild className="h-11"><Link href="/ads/campaigns">See them in Campaigns</Link></Button>
        </div>
      ) : (
        <div className="space-y-3">
          <section className="rounded-xl border p-4 space-y-2">
            <h2 className="font-semibold">Campaign</h2>
            <select value={target} onChange={e => pickCampaign(e.target.value)} className="w-full rounded-md border bg-background px-3 h-10 text-base sm:text-sm">
              <option value="new">A new campaign</option>
              {(tree ?? []).filter(c => c.status !== 'ARCHIVED').map(c => <option key={c.id} value={c.id}>{c.name} · {objectiveLabel(c.objective)}</option>)}
              {campaign && !tree?.some(c => c.id === campaign.id) && <option value={campaign.id}>{campaign.name}</option>}
            </select>
            {target === 'new' && <Input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="Campaign name" className="h-10 text-base sm:text-sm" />}
            {budgeted && <p className="text-xs text-muted-foreground">This campaign holds the budget; its ad sets share it.</p>}
          </section>

          {sets.map((s, i) => {
            const isOpen = open === s.key || sets.length === 1;
            return (
              <section key={s.key} className="rounded-xl border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground text-xs shrink-0">{i + 1}</span>
                  <Input value={s.name} onChange={e => change(s.key, { name: e.target.value })} className="h-9 text-base sm:text-sm font-medium" aria-label="Ad set name" />
                  {sets.length > 1 && <Button variant="ghost" size="icon" className="h-8 w-8 min-h-0 shrink-0" aria-label="Remove" onClick={() => setSets(ss => ss.filter(x => x.key !== s.key))}><Trash2 className="h-4 w-4" /></Button>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allowed.map(g => (
                    <button key={g.key} type="button" onClick={() => change(s.key, { goal: g.key })}
                      className={cn('rounded-full border px-3 py-1 text-xs min-h-0', s.goal === g.key ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>{g.label}</button>
                  ))}
                </div>
                {!budgeted && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-md border overflow-hidden text-xs">
                      {(['daily', 'total'] as const).map(k => <button key={k} type="button" onClick={() => change(s.key, { budget: { ...s.budget, kind: k } })} className={cn('px-3 py-1.5 min-h-0', s.budget.kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{k === 'daily' ? 'A day' : 'In total'}</button>)}
                    </div>
                    <AmountInput value={s.budget.amount || undefined} onValueChange={v => change(s.key, { budget: { ...s.budget, amount: v ?? 0 } })} className="h-9 w-32 tabular-nums" aria-label="Budget" />
                    <span className="text-xs text-muted-foreground">{currency}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1">From <Input type="date" value={dateInput(s.budget.start)} onChange={e => change(s.key, { budget: { ...s.budget, start: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null } })} className="h-8 w-40 text-base sm:text-xs" /></label>
                  <label className="flex items-center gap-1">to <Input type="date" value={dateInput(s.budget.end)} onChange={e => change(s.key, { budget: { ...s.budget, end: e.target.value ? new Date(`${e.target.value}T23:59:00`).toISOString() : null } })} className="h-8 w-40 text-base sm:text-xs" /></label>
                </div>
                <button type="button" onClick={() => setOpen(isOpen && sets.length > 1 ? null : s.key)} className="w-full flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-left text-xs min-h-0">
                  <span className="truncate">{describeAudience(s.audience)}</span>
                  {isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                </button>
                {isOpen && <AudienceEditor draft={s.audience} onChange={a => change(s.key, { audience: a })} goal={goalOf(s.goal).optimization} currency={currency} />}
              </section>
            );
          })}
          <Button variant="outline" className="w-full" onClick={add} disabled={sets.length >= 6} title="Starts as a copy of the last, so a test changes one thing"><Plus className="h-4 w-4 mr-1" /> Another ad set</Button>

          <section className="rounded-xl border p-4 space-y-2">
            <h2 className="font-semibold">Ads in them</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {([['copy', 'Copies of ads', <Copy key="c" className="h-4 w-4" />], ['post', 'An Instagram post', <Instagram key="i" className="h-4 w-4" />]] as const).map(([k, label, icon]) => (
                <button key={k} type="button" onClick={() => setAdsKind(k)} className={cn('flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs', adsKind === k ? 'border-primary bg-primary/10' : 'text-muted-foreground')}>{icon}{label}</button>
              ))}
            </div>
            {adsKind === 'copy' ? (
              treeError ? <ErrorLine error={treeError} /> : !tree ? <p className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> …</p> : (
                <>
                  <div className="relative"><Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" /><Input value={adQ} onChange={e => setAdQ(e.target.value)} placeholder="Find an ad" className="h-9 pl-8 text-base sm:text-xs" /></div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-80 overflow-y-auto">
                    {shownAds.map(a => {
                      const on = adIds.includes(a.id);
                      return (
                        <button key={a.id} type="button" onClick={() => setAdIds(v => (on ? v.filter(x => x !== a.id) : [...v, a.id]))} className={cn('relative rounded-lg border overflow-hidden text-left min-h-0', on && 'ring-2 ring-primary')}>
                          {a.image || a.thumbnail ? <img src={a.image ?? a.thumbnail!} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-muted" />}
                          <p className="px-1.5 py-1 text-[10px] leading-tight line-clamp-2">{a.name}</p>
                          {on && <Check className="absolute top-1 right-1 h-4 w-4 rounded-full bg-primary text-primary-foreground p-0.5" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )
            ) : (
              <>
                {!media ? <p className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> …</p> : (
                  <div className="grid grid-cols-4 gap-1.5 max-h-72 overflow-y-auto">
                    {media.filter(m => m.boostable !== false).map(m => (
                      <button key={m.id} type="button" onClick={() => setPost(m.id)} className={cn('rounded-lg overflow-hidden border min-h-0', post === m.id && 'ring-2 ring-primary')}>
                        {m.thumb ? <img src={m.thumb} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-muted" />}
                      </button>
                    ))}
                  </div>
                )}
                {sets.some(s => goesToSite(s.goal) || s.goal === 'channel') && <Input value={link} onChange={e => setLink(e.target.value)} placeholder="https://… — where the button goes" inputMode="url" className="h-9 text-base sm:text-xs" />}
              </>
            )}
          </section>

          <section className="rounded-xl border p-4 space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              {(['paused', 'live'] as const).map(k => <button key={k} type="button" onClick={() => setLaunch(k)} className={cn('rounded-lg border p-2 text-xs', launch === k ? 'border-primary bg-primary/10' : 'text-muted-foreground')}>{k === 'paused' ? 'Make them paused' : 'Run them once approved'}</button>)}
            </div>
            {problems.length > 0 && <ul className="text-xs text-warning list-disc pl-4">{problems.slice(0, 4).map(p => <li key={p}>{p}</li>)}</ul>}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button className="w-full h-11" disabled={busy || problems.length > 0} onClick={make}>
              {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Layers className="h-4 w-4 mr-1.5" />}
              Make {sets.length} ad set{sets.length === 1 ? '' : 's'} · {adCount(design)} ad{adCount(design) === 1 ? '' : 's'}
            </Button>
          </section>
        </div>
      )}
    </PageShell>
  );
}

