'use client';

/**
 * The Publish sheet — one list for everywhere a design can go (docs/features/design-studio-plan.md §5.3).
 *
 * Rows come from GET /api/design/destinations, so a house or a person who lacks a place never sees a button for
 * it: Mina has no channel, no set of the day, and posts to Instagram through the share sheet; staff have no Meta
 * ad. A place whose shape the design lacks (WhatsApp and the website only ever get 1:1, a story is 9:16) offers
 * "Make 1:1 from this" instead of failing — it calls `onNeedSize(presetId)` and the shell (WP3's resize) adds the
 * page; the sheet picks it up from `pages`.
 *
 * Sending is the plan of lib/design/publish.ts: each place a step, one at a time, a step that went never runs
 * again, and "Retry" runs only those that failed. Every success is noted on the design (publish list).
 *
 * Props (PublishSheetProps):
 *   design      the words and identity of what is sent: { id?, name, kind, fields, copy, source?, master, folder? }
 *   pages       the design's pages (DesignPage[]); a place takes the page whose shape it needs
 *   render      (pageId, px) → Blob: the page drawn as a JPEG `px` wide; the sheet asks for what each place needs
 *   onNeedSize  (presetId) → void: add a page at that size (sizes.ts SIZE_PRESETS id: 'whatsapp', 'story', 'square'…)
 *   onDone      ({ ok, designId, memory }) → void: everything chosen has gone (or been shared by hand)
 *   docOf       optional (pageId) → the page's layout document; turns on "Save the design" and lets
 *               "Replace the photo" keep its layout
 *   stamped     optional: the weight is printed on the picture ("Replace the photo" tells the site)
 *   onSaved     optional (id) → void: the Save step gave the design its id (the shell should adopt it)
 *   open, onOpenChange   when `open` is given the sheet is a bottom drawer; without it, it is the panel inline
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Loader2, Send, CheckCircle2, XCircle, Instagram, MessageCircle, Globe, Sparkles, Download, Save, Clock, Wand2, Share2, RotateCcw, Link2, Copy, ExternalLink, Images } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_LINKS, STORE_WHATSAPP_NUMBERS } from '@/lib/store-config';
import { authHeaders } from '@/app/ads/ads-kit';
import { HealthPanel, useHealth } from '@/app/website/post/health-panel';
import { postAi } from '@/lib/social/ai-client';
import type { CaptionResult } from '@/lib/social/prompts';
import type { DesignKind, DesignPage, DestinationId } from '@/lib/design/model';
import { sizePreset } from '@/lib/design/sizes';
import { isMaisonFolder, MAISON_HOUSES } from '@/lib/website/maisons';
import { SetOfTheDayCard } from '@/components/website/set-of-the-day';
import { Input } from '@/components/ui/input';
import { makeLabel, pageFor, type DestinationInfo } from '@/lib/design/destinations';
import {
  buildPlan, checkGroupOf, downloadBlob, httpSenders, initialStates, loadMemory, markDone, runSteps, saveMemory, shareImage, wordProblems,
  type Choices, type Memory, type PublishDesign, type PublishStep, type StepState,
} from '@/lib/design/publish';

export interface PublishSheetProps {
  design: PublishDesign;
  pages: DesignPage[];
  render: (pageId: string, px: number) => Promise<Blob>;
  onNeedSize: (presetId: string) => void;
  onDone?: (r: { ok: boolean; designId?: string; memory: Memory }) => void;
  docOf?: (pageId: string) => unknown;
  stamped?: boolean;
  /** More photographs of the piece, drawn on a page (`index` 1 is the first): the website and WhatsApp get each as a square. */
  more?: { count: number; render: (pageId: string, index: number, px: number) => Promise<Blob> };
  onSaved?: (id: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface Collection { folder: string; category: string; collection: string }
interface Loaded { rows: DestinationInfo[]; collections: Collection[] }

const senders = httpSenders(authHeaders);
const chip = (on: boolean, off = false) => cn('rounded-full border px-2.5 py-1 text-[11px] min-h-0 inline-flex items-center gap-1', off ? 'opacity-50' : '', on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground');
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* fine */ } };

/** What each kind of design ticks to begin with; the person changes it. */
function defaultsFor(kind: DesignKind): { website: boolean; wa: boolean; story: boolean; post: boolean; meta: boolean } {
  switch (kind) {
    case 'piece': return { website: true, wa: true, story: true, post: false, meta: false };
    case 'story': return { website: false, wa: false, story: true, post: false, meta: false };
    case 'post': return { website: false, wa: true, story: false, post: true, meta: false };
    case 'whatsapp': return { website: false, wa: true, story: false, post: false, meta: false };
    case 'site': return { website: true, wa: false, story: false, post: false, meta: false };
    case 'ad': return { website: false, wa: false, story: false, post: false, meta: true };
    default: return { website: false, wa: false, story: false, post: false, meta: false };
  }
}

export function PublishSheet(props: PublishSheetProps) {
  if (props.open === undefined) return <PublishPanel {...props} />;
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] overflow-y-auto sm:max-w-2xl sm:rounded-t-2xl">
        <SheetHeader><SheetTitle>Publish</SheetTitle></SheetHeader>
        <PublishPanel {...props} />
      </SheetContent>
    </Sheet>
  );
}

function PublishPanel({ design, pages, render, onNeedSize, onDone, docOf, stamped, more, onSaved }: PublishSheetProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fromSite = !!design.source?.siteId;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/design/destinations?collections=1${fromSite ? '&fromSite=1' : ''}`, { headers: await authHeaders(), cache: 'no-store' });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || `Could not read where this can go (${res.status}).`);
        if (alive) setLoaded({ rows: d.rows as DestinationInfo[], collections: (d.collections ?? []) as Collection[] });
      } catch (e) { if (alive) setLoadError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; };
  }, [fromSite]);

  const rows = loaded?.rows ?? [];
  const row = (id: DestinationId) => rows.find(r => r.id === id);
  const ok = (id: DestinationId) => !!row(id)?.available;

  // ── Choices ──
  const def = defaultsFor(design.kind);
  const [folder, setFolder] = useState('');
  const [websiteOn, setWebsiteOn] = useState(def.website);
  const [featured, setFeatured] = useState(false);
  // What the site calls the piece (the headline until it is changed), and — in The Maisons — its house.
  const [siteName, setSiteName] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [house, setHouse] = useState('');
  const [waOn, setWaOn] = useState(def.wa);
  const [waKeys, setWaKeys] = useState<string[]>([]);
  const [storyOn, setStoryOn] = useState(def.story);
  const [postOn, setPostOn] = useState(def.post);
  const [metaOn, setMetaOn] = useState(def.meta);
  const [replaceOn, setReplaceOn] = useState(false);
  const [saveOn, setSaveOn] = useState(false);
  const [when, setWhen] = useState<'now' | 'hold' | 'schedule'>('now');
  const [dueLocal, setDueLocal] = useState('');
  const [wa, setWa] = useState(design.copy.wa ?? '');
  const [ig, setIg] = useState(design.copy.ig ?? '');
  const [adText, setAdText] = useState(design.copy.adText ?? '');
  const [adHeadline, setAdHeadline] = useState(design.copy.adHeadline ?? design.fields.headline);

  // The remembered collection and WhatsApp places, once the rows say what exists.
  const seeded = useRef(false);
  useEffect(() => {
    if (!loaded || seeded.current) return;
    seeded.current = true;
    const last = lsGet('taheri_post_folder');
    if (last && loaded.collections.some(c => c.folder === last)) setFolder(last);
    const keys = [...(row('whatsapp')?.targets ?? []), ...(row('channel')?.targets ?? [])].map(t => t.key);
    const wanted = (lsGet('design_wa_targets') ?? '').split(',').filter(k => keys.includes(k));
    setWaKeys(wanted.length ? wanted : [...(row('whatsapp')?.targets ?? []).slice(0, 1), ...(row('channel')?.targets ?? [])].map(t => t.key));
    if (!ok('website')) setWebsiteOn(false);
    if (!ok('whatsapp') && !ok('channel')) setWaOn(false);
    if (!ok('meta-ad')) setMetaOn(false);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (folder) lsSet('taheri_post_folder', folder); }, [folder]);
  useEffect(() => { if (seeded.current && waKeys.length) lsSet('design_wa_targets', waKeys.join(',')); }, [waKeys]);

  const igMode = (id: 'instagram-story' | 'instagram-post') => row(id)?.mode ?? 'share';
  const choices: Choices = {
    website: websiteOn && ok('website') && folder ? { folder, ...(siteName.trim() ? { name: siteName.trim() } : {}), ...(isMaisonFolder(folder) && house ? { house } : {}) } : null,
    featured: websiteOn && featured && ok('featured'),
    whatsapp: waOn ? waKeys.filter(k => (k === 'channel' ? ok('channel') : ok('whatsapp'))) : [],
    instagramStory: storyOn ? igMode('instagram-story') : null,
    instagramPost: postOn ? igMode('instagram-post') : null,
    metaAd: metaOn && ok('meta-ad'),
    siteReplace: replaceOn && ok('site-replace'),
    save: saveOn && !!docOf,
    queue: when === 'now' ? null : { dueAt: when === 'schedule' && dueLocal ? new Date(dueLocal).toISOString() : null },
    captions: { wa, ig, adText, adHeadline },
  };

  // ── The plan ──
  const memoryKey = design.id ?? design.name;
  const [memory] = useState<Memory>(() => loadMemory(memoryKey));
  const [states, setStates] = useState<StepState[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const health = useHealth();

  const plan = useMemo(
    () => buildPlan({ design, pages, render, docOf, stamped, more, link: STORE_LINKS.website || undefined, senders }, choices),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [design, pages, render, docOf, stamped, more, JSON.stringify(choices)],
  );
  const shown = states.length ? states : initialStates(plan.steps, memory);
  const stateOf = (s: PublishStep): StepState => shown.find(x => x.id === s.id) ?? initialStates([s], memory)[0];

  const problems: string[] = [];
  if (websiteOn && ok('website') && !folder) problems.push('Choose a website collection, or switch the website off.');
  if (websiteOn && ok('website') && isMaisonFolder(folder) && !house) problems.push('Choose the piece’s house for The Maisons.');
  if (waOn && ok('whatsapp') && !choices.whatsapp?.length) problems.push('Choose a WhatsApp group or the channel, or switch WhatsApp off.');
  if (when === 'schedule' && !dueLocal) problems.push('Choose a time to send it.');
  if (!plan.steps.length && !plan.missing.length) problems.push('Choose where it goes.');
  const wordIssues = wordProblems({ 'WhatsApp caption': choices.whatsapp?.length ? wa : '', 'Instagram caption': postOn ? ig : '', 'ad text': metaOn ? adText : '', 'ad headline': metaOn ? adHeadline : '' }, design.fields.weight);
  const toCheck = plan.steps.filter(s => memory[s.id] === undefined);
  const failingGroups = [...new Set(toCheck.map(s => checkGroupOf(s.dest)).filter((g): g is NonNullable<typeof g> => !!g))]
    .filter(g => (health.report?.checks ?? []).some(c => c.status === 'fail' && c.group === g));
  const wholeCommunity = (choices.whatsapp ?? []).includes('announcements');

  const designId = memory.save || design.id;
  const run = useCallback(async (only?: string) => {
    setBusy(true); setConfirming(false); setNote(null);
    try {
      const out = await runSteps(plan.steps, memory, {
        only,
        onState: s => { setStates(prev => { const rest = prev.length ? prev : initialStates(plan.steps, memory); return rest.map(x => (x.id === s.id ? s : x)); }); saveMemory(memoryKey, memory); },
        record: async (step, ref) => {
          if (step.id === 'save') { onSaved?.(ref); return; }
          const id = memory.save || design.id;
          if (id) await senders.record(id, { dest: step.id, ok: true, ref });
        },
      });
      setStates(out);
      const left = plan.steps.filter(s => memory[s.id] === undefined);
      if (!left.length) onDone?.({ ok: true, designId: memory.save || design.id, memory });
    } finally { setBusy(false); health.refresh(); }
  }, [plan, memory, memoryKey, design.id, onSaved, onDone, health]);

  const onSend = () => {
    if (problems.length || wordIssues.length) return;
    if (choices.whatsapp?.length || choices.instagramStory === 'api' || choices.instagramPost === 'api' || failingGroups.length) setConfirming(true);
    else void run();
  };

  const connectInstagram = async () => {
    try {
      const res = await fetch('/api/instagram/connect', { method: 'POST', headers: await authHeaders() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || `Instagram answered ${res.status}.`);
      window.location.href = d.url;
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not start the Instagram connection.'); }
  };

  const share = async (s: PublishStep) => {
    if (!s.share) return;
    const { blob, name } = await s.share();
    if (s.id === 'instagram-post' && ig.trim()) { try { await navigator.clipboard.writeText(ig.trim()); setNote('The caption is copied — paste it in Instagram.'); } catch { /* fine */ } }
    if (await shareImage(blob, name)) { markDone(memory, s.id); saveMemory(memoryKey, memory); setStates(initialStates(plan.steps, memory)); }
    else { downloadBlob(blob, name); setNote('This device has no share sheet, so it was saved. Post it from Instagram, then press “Posted”.'); }
  };
  const posted = (s: PublishStep) => { markDone(memory, s.id, 'by hand'); saveMemory(memoryKey, memory); setStates(initialStates(plan.steps, memory)); };

  const writeWithAi = async () => {
    setAiBusy(true); setNote(null);
    try {
      const page = pages.find(p => p.id === design.master) ?? pages[0];
      const f = new FormData();
      f.set('op', 'caption');
      f.set('params', JSON.stringify({ headline: design.fields.headline, weight: design.fields.weight, metal: '', stones: '', collection: folder.split('/')[1] ?? '', numbers: STORE_WHATSAPP_NUMBERS, link: STORE_LINKS.website, brief: '' }));
      f.append('image', await render(page.id, 1024), 'image-0.jpg');
      const d = await postAi<{ caption: CaptionResult }>(f, await authHeaders());
      if (d.caption.whatsappCaption) setWa(d.caption.whatsappCaption);
      if (d.caption.instagramCaption) setIg(d.caption.instagramCaption);
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not write the captions.'); }
    finally { setAiBusy(false); }
  };

  const downloadAll = async () => {
    setDownloading(true);
    try {
      for (const p of pages) {
        const px = sizePreset(p.format)?.px ?? 1080;
        downloadBlob(await render(p.id, px), `${(design.fields.headline || design.name).replace(/[^\w-]+/g, '-').slice(0, 60)}-${p.label || p.format}.jpg`);
      }
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not draw it.'); }
    finally { setDownloading(false); }
  };

  const fileBase = () => (design.fields.headline || design.name).replace(/[^\w-]+/g, '-').slice(0, 60);
  /** From the phone: every size to Photos at once (the share sheet), the picture with its caption, the caption alone. */
  const shareAll = async () => {
    setDownloading(true);
    try {
      const files = await Promise.all(pages.map(async p => new File([await render(p.id, sizePreset(p.format)?.px ?? 1080)], `${fileBase()}-${(p.label || p.format).replace(/[^\w-]+/g, '-')}.jpg`, { type: 'image/jpeg' })));
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
        try { await navigator.share({ files }); } catch (e) { if ((e as Error).name !== 'AbortError') throw e; }
      } else files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 300));
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not draw it.'); }
    finally { setDownloading(false); }
  };
  const shareWithCaption = async () => {
    try {
      const pick = pageFor(pages, design.master, 'whatsapp');
      if (!('page' in pick)) { setNote('Make a 1:1 size first (Make 1:1 from this).'); return; }
      const f = new File([await render(pick.page.id, 1600)], `${fileBase()}.jpg`, { type: 'image/jpeg' });
      // WhatsApp often drops text shared alongside a file, so the caption goes on the clipboard too.
      try { await navigator.clipboard.writeText(wa); } catch { /* said below either way */ }
      const data: ShareData = { files: [f], ...(wa ? { text: wa } : {}) };
      if (typeof navigator.canShare === 'function' && navigator.canShare(data)) { try { await navigator.share(data); } catch (e) { if ((e as Error).name !== 'AbortError') throw e; } }
      else downloadBlob(f, f.name);
      setNote(wa ? 'The caption is on the clipboard — paste it under the picture.' : null);
    } catch (e) { setNote(e instanceof Error ? e.message : 'Could not share it.'); }
  };
  const copyCaption = async () => { try { await navigator.clipboard.writeText(wa); setNote('The caption is copied.'); } catch { setNote('Could not copy — select it and copy it by hand.'); } };

  const forgetAll = () => { for (const k of Object.keys(memory)) delete memory[k]; saveMemory(memoryKey, memory); setStates([]); };

  const missingFor = (id: DestinationId) => {
    const pick = pageFor(pages, design.master, id);
    return 'missing' in pick ? pick.missing : null;
  };
  const makeButton = (id: DestinationId) => {
    const m = missingFor(id);
    return m ? (
      <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={() => onNeedSize(m.id)}>
        <Wand2 className="h-3 w-3 mr-1" /> {makeLabel(m)}
      </Button>
    ) : null;
  };

  const waRow = row('whatsapp'), chRow = row('channel');
  const needsAnyCaption = waOn || postOn;
  const allDone = plan.steps.length > 0 && plan.steps.every(s => memory[s.id] !== undefined);
  const anyFailed = shown.some(s => s.status === 'failed');
  const metaStep = plan.steps.find(s => s.id === 'meta-ad');
  const metaHref = metaStep ? memory['meta-ad'] : undefined;

  if (loadError) return <p className="text-xs text-destructive p-3">{loadError}</p>;
  if (!loaded) return <p className="text-xs text-muted-foreground p-3"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> Looking at where this can go…</p>;

  const toggle = (label: React.ReactNode, id: DestinationId, on: boolean, set: (v: boolean) => void, icon: React.ReactNode, extra?: React.ReactNode) => {
    const r = row(id);
    if (!r) return null;
    return (
      <div key={id} className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={!r.available && !r.mode} onClick={() => set(!on)} className={chip(on && (r.available || !!r.mode), !r.available && !r.mode)} aria-pressed={on}>
            {icon} {label}
          </button>
          {on && (r.available || !!r.mode) && makeButton(id)}
          {extra}
        </div>
        {r.reason && <p className="text-[11px] text-muted-foreground pl-1">{r.reason}</p>}
        {r.connectable && on && (
          <Button type="button" size="sm" variant="outline" className="ml-1 h-7 px-2 text-[11px]" onClick={() => void connectInstagram()}><Link2 className="mr-1 h-3 w-3" /> Connect Instagram</Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3 text-sm">
      <HealthPanel health={health} />

      <div className="space-y-2">
        {row('website') && (
          <>
            {toggle('Website', 'website', websiteOn, setWebsiteOn, <Globe className="h-3 w-3" />)}
            {websiteOn && ok('website') && (
              <div className="pl-1 space-y-1.5">
                <select value={folder} onChange={e => setFolder(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1 text-base sm:text-xs" aria-label="Website collection">
                  <option value="">Choose a collection…</option>
                  {loaded.collections.map(c => <option key={c.folder} value={c.folder}>{c.category === c.collection ? c.collection : `${c.category} · ${c.collection}`}</option>)}
                </select>
                {ok('featured') && (
                  <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} /> Set of the day on the home page</label>
                )}
                {ok('featured') && featured && <SetOfTheDayCard variant="compact" />}
                {isMaisonFolder(folder) && (
                  <select value={house} onChange={e => setHouse(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1 text-base sm:text-xs" aria-label="House">
                    <option value="">The house — Cartier, Van Cleef &amp; Arpels…</option>
                    {MAISON_HOUSES.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                )}
                {renameOpen || isMaisonFolder(folder) ? (
                  <div className="space-y-0.5">
                    <label className="text-[11px] text-muted-foreground" htmlFor="site-name">{isMaisonFolder(folder) ? 'Official name, as the house names it' : 'Name on the website'}</label>
                    <Input id="site-name" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder={design.fields.headline || design.name} className="h-8 text-base sm:text-xs" />
                    {isMaisonFolder(folder) && <p className="text-[11px] text-muted-foreground">Shown under its house, in 18k, with no gold-rate price.</p>}
                  </div>
                ) : (
                  <p className="truncate text-[11px] text-muted-foreground">Named “{siteName.trim() || design.fields.headline || design.name}” · <button type="button" className="min-h-0 text-primary" onClick={() => setRenameOpen(true)}>Change</button></p>
                )}
                {!pages.some(p => p.label === sizePreset('website')?.label) && (
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onNeedSize('website')}>
                    <Wand2 className="mr-1 h-3 w-3" /> Make the catalogue photo (weight stamped)
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {(waRow || chRow) && toggle('WhatsApp', 'whatsapp', waOn, setWaOn, <MessageCircle className="h-3 w-3" />)}
        {waOn && (
          <div className="flex flex-wrap gap-1.5 pl-1">
            {[...(waRow?.available ? waRow.targets ?? [] : []), ...(chRow?.available ? chRow.targets ?? [] : [])].map(t => (
              <button key={t.key} type="button" className={chip(waKeys.includes(t.key))} aria-pressed={waKeys.includes(t.key)}
                onClick={() => setWaKeys(v => (v.includes(t.key) ? v.filter(x => x !== t.key) : [...v, t.key]))}>
                {t.label}{t.key === 'channel' ? ' (channel)' : ''}
              </button>
            ))}
            {(!waRow?.available && !chRow?.available) && <p className="text-[11px] text-muted-foreground">{waRow?.reason}</p>}
          </div>
        )}
        {waOn && !!choices.whatsapp?.length && makeButton('whatsapp')}

        {toggle(<>Instagram story{igMode('instagram-story') === 'share' ? ' (share sheet)' : ''}</>, 'instagram-story', storyOn, setStoryOn, <Instagram className="h-3 w-3" />)}
        {toggle(<>Instagram post{igMode('instagram-post') === 'share' ? ' (share sheet)' : ''}</>, 'instagram-post', postOn, setPostOn, <Instagram className="h-3 w-3" />)}
        {row('meta-ad')?.available && toggle('Meta ad', 'meta-ad', metaOn, setMetaOn, <Sparkles className="h-3 w-3" />)}
        {row('site-replace')?.available && toggle('Replace the photo on the website', 'site-replace', replaceOn, setReplaceOn, <Globe className="h-3 w-3" />)}
        {docOf && (
          <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={saveOn} onChange={e => setSaveOn(e.target.checked)} /> <Save className="h-3 w-3" /> Save the design</label>
        )}
      </div>

      {needsAnyCaption && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium">Captions</span>
            <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] px-2" disabled={aiBusy} onClick={writeWithAi}>
              {aiBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />} Write with AI
            </Button>
          </div>
          {waOn && <Textarea value={wa} onChange={e => setWa(e.target.value)} rows={3} className="text-base sm:text-xs" aria-label="WhatsApp caption" placeholder="WhatsApp caption" />}
          {postOn && <Textarea value={ig} onChange={e => setIg(e.target.value)} rows={3} className="text-base sm:text-xs" aria-label="Instagram caption" placeholder="Instagram caption" />}
        </div>
      )}
      {metaOn && ok('meta-ad') && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium">Meta ad words</span>
          <input value={adHeadline} onChange={e => setAdHeadline(e.target.value)} className="w-full rounded-md border bg-background px-2 py-1 text-base sm:text-xs" aria-label="Ad headline" placeholder="Headline" />
          <Textarea value={adText} onChange={e => setAdText(e.target.value)} rows={3} className="text-base sm:text-xs" aria-label="Ad primary text" placeholder="Primary text" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Clock className="h-3 w-3 text-muted-foreground" />
        {([['now', 'Send now'], ['hold', 'Hold in the queue'], ['schedule', 'Schedule']] as const).map(([v, label]) => (
          <button key={v} type="button" className={chip(when === v)} aria-pressed={when === v} onClick={() => setWhen(v)}>{label}</button>
        ))}
        {when === 'schedule' && <input type="datetime-local" value={dueLocal} onChange={e => setDueLocal(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-base sm:text-xs" aria-label="Send at" />}
      </div>
      {when !== 'now' && postOn && <p className="text-[11px] text-muted-foreground">The queue carries the website, WhatsApp and the story; the Instagram post goes out now, not from the queue.</p>}

      {[...problems, ...wordIssues].length > 0 && (
        <ul className="text-[11px] text-destructive space-y-0.5">{[...problems, ...wordIssues].map(p => <li key={p}>{p}</li>)}</ul>
      )}

      {confirming ? (
        <div className="rounded-lg border p-2.5 space-y-2 bg-muted/30">
          <p className="text-xs">
            {wholeCommunity ? 'This reaches the whole community — a thousand-odd customers. ' : ''}
            Send to {toCheck.filter(s => !s.manual).length} place{toCheck.filter(s => !s.manual).length === 1 ? '' : 's'}?
            {failingGroups.length ? ` A check is failing for ${failingGroups.join(' and ')} — it may not go.` : ''}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void run()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Yes, send</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Not yet</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="w-full" disabled={busy || problems.length > 0 || wordIssues.length > 0 || plan.steps.length === 0 || allDone} onClick={onSend}>
          {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
          {when === 'now' ? 'Publish' : when === 'hold' ? 'Hold in the queue' : 'Schedule'}
        </Button>
      )}

      {plan.steps.length > 0 && (
        <ul className="text-[11px] space-y-1" aria-live="polite">
          {plan.steps.map(s => {
            const st = stateOf(s);
            return (
              <li key={s.id} className={cn('flex flex-wrap items-center gap-1.5', st.status === 'done' ? 'text-success' : st.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                {st.status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : st.status === 'failed' ? <XCircle className="h-3.5 w-3.5 shrink-0" /> : st.status === 'running' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border" />}
                <span>{s.label}{st.error ? ` — ${st.error}` : ''}</span>
                {st.status === 'failed' && <Button type="button" size="sm" variant="outline" className="h-6 text-[11px] px-2" disabled={busy} onClick={() => void run(s.id)}><RotateCcw className="h-3 w-3 mr-1" /> Retry</Button>}
                {s.manual && st.status === 'manual' && (
                  <>
                    <Button type="button" size="sm" variant="outline" className="h-6 text-[11px] px-2" onClick={() => void share(s)}><Share2 className="h-3 w-3 mr-1" /> Share it</Button>
                    <Button type="button" size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={() => posted(s)}>Posted</Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {anyFailed && !busy && (
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => void run()}><RotateCcw className="h-4 w-4 mr-1" /> Retry what failed</Button>
      )}
      {metaHref && <Button asChild size="sm" variant="outline" className="w-full"><a href={metaHref}><Sparkles className="h-4 w-4 mr-1" /> Open the new ad</a></Button>}
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}

      <div className="flex flex-wrap gap-2 pt-1 border-t">
        <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px] px-2" disabled={downloading} onClick={downloadAll}>
          {downloading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />} Download every size
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px] px-2" disabled={downloading} onClick={() => void shareAll()} title="Every size to the phone’s photos at once">
          <Images className="h-3 w-3 mr-1" /> Save all to Photos
        </Button>
        {(waRow || chRow) && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => void shareWithCaption()}>
            <Share2 className="h-3 w-3 mr-1" /> Share the picture
          </Button>
        )}
        {wa.trim() && <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={() => void copyCaption()}><Copy className="h-3 w-3 mr-1" /> Copy the caption</Button>}
        {STORE_LINKS.waChannel && (
          <Button asChild size="sm" variant="ghost" className="h-7 text-[11px] px-2"><a href={STORE_LINKS.waChannel} target="_blank" rel="noopener"><ExternalLink className="h-3 w-3 mr-1" /> Open the WhatsApp channel</a></Button>
        )}
        {Object.keys(memory).length > 0 && <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px] px-2" disabled={busy} onClick={forgetAll}>Send again from the start</Button>}
      </div>
    </div>
  );
}
