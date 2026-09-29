'use client';

/**
 * The studio's photographs: the best for the chosen placement (Picks) and all of them
 * (Library), each assessed once by the vision model, and the sheet a photo opens in —
 * its assessment, its fixes (the same AI Post a Piece uses) and "make an ad with it".
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import {
  Sparkles, Loader2, Globe, HardDrive, Search, RefreshCw, Wand2, Download, Brush, ExternalLink, Copy, AlertTriangle,
  CheckCircle2, Crop, ImageIcon, ShieldAlert, PauseCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIXES, PLACEMENT_LABEL, PLACEMENTS, type FixCode, type Placement } from '@/lib/ads/studio/assessment';
import { SCENES } from '@/lib/social/prompts';
import { api } from '../ads-kit';
import {
  AuthedImg, FIX_OPS, Meter, ScoreBadge, downloadBlob, fetchAsset, runImageOp, safeName, scoreWord,
  type FixResult, type LibraryItem, type LibraryResponse, type WorkPhoto,
} from './studio-kit';

const PLACEMENT_KEY = 'taheri_studio_placement';
export function usePlacement(): [Placement, (p: Placement) => void] {
  const [p, setP] = useState<Placement>('portrait');
  useEffect(() => { try { const v = localStorage.getItem(PLACEMENT_KEY); if (v && (PLACEMENTS as readonly string[]).includes(v)) setP(v as Placement); } catch { /* private mode */ } }, []);
  return [p, (v: Placement) => { setP(v); try { localStorage.setItem(PLACEMENT_KEY, v); } catch { /* private mode */ } }];
}

export function PlacementPicker({ value, onChange }: { value: Placement; onChange: (p: Placement) => void }) {
  return (
    <div className="inline-flex rounded-full border p-0.5" role="radiogroup" aria-label="Where the ad shows">
      {PLACEMENTS.map(p => (
        <button key={p} type="button" role="radio" aria-checked={value === p} onClick={() => onChange(p)}
          className={cn('rounded-full px-3 py-1.5 text-xs min-h-0 whitespace-nowrap', value === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {PLACEMENT_LABEL[p]}
        </button>
      ))}
    </div>
  );
}

function useLibrary(query: string) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async (fresh = false) => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<LibraryResponse>(`/api/ads/studio/library?${query}${fresh ? '&fresh=1' : ''}`);
      if (n === seq.current) { setData(d); setError(null); }
    } catch (e) { if (n === seq.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (n === seq.current) setLoading(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

// ── Assessing ──────────────────────────────────────────────────────────────

interface AssessAnswer { done: string[]; failed: { id: string; error: string }[]; stopped: string | null; more: boolean; assessed: number; remaining: number; seconds: number }

/** The vision model working through the library while the page is open. */
export function useAssessRunner(onBatch: () => void) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [left, setLeft] = useState<number | null>(null);
  const stop = useRef(false);
  const run = useCallback(async (body: Record<string, unknown>, loop: boolean) => {
    if (running) return;
    stop.current = false; setRunning(true); setDone(0);
    try {
      for (;;) {
        const d = await api<AssessAnswer>('/api/ads/studio/assess', { body: { ...body, budgetMs: loop ? 200_000 : 120_000 } });
        setDone(n => n + d.done.length); setLeft(d.remaining);
        onBatch();
        if (d.stopped) { toast({ title: 'Assessing stopped', description: d.stopped, variant: 'destructive' }); break; }
        if (!loop && d.failed.length && !d.done.length) { toast({ title: 'Couldn’t assess', description: d.failed[0].error, variant: 'destructive' }); break; }
        if (!loop || !d.more || stop.current) break;
      }
    } catch (e) {
      toast({ title: 'Couldn’t assess', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setRunning(false); }
  }, [running, onBatch, toast]);
  return {
    running, done, left,
    all: () => run({ next: true }, true),
    these: (ids: string[], force = false) => run({ ids, force }, false),
    stop: () => { stop.current = true; },
  };
}

export function AssessBar({ counts, runner, big }: { counts: LibraryResponse['counts']; runner: ReturnType<typeof useAssessRunner>; big?: boolean }) {
  const left = counts.total - counts.assessed;
  const pctDone = counts.total ? Math.round((counts.assessed / counts.total) * 100) : 0;
  return (
    <div className={cn('rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center gap-3', big && 'p-4 bg-primary/5 border-primary/30')}>
      <div className="flex-1 min-w-0 space-y-1.5">
        <p className="text-sm font-medium">
          {counts.assessed.toLocaleString('en-US')} of {counts.total.toLocaleString('en-US')} photos looked at
          <span className="text-muted-foreground font-normal"> · {counts.site.toLocaleString('en-US')} from taheri.shop, {counts.drive.toLocaleString('en-US')} from Drive</span>
        </p>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pctDone}%` }} /></div>
        {runner.running
          ? <p className="text-[11px] text-muted-foreground">Looking at the newest first, ten to a call — {runner.done} done this run{runner.left !== null ? `, ${runner.left.toLocaleString('en-US')} to go` : ''}. Keep the page open; anything done is kept.</p>
          : left > 0 && <p className="text-[11px] text-muted-foreground">The vision model scores each photo as an ad — fit for 1:1, 4:5 and 9:16, light, sharpness, burned-in labels, anything against the house’s rules — and names the fixes. About {Math.max(1, Math.round(left / 600))} hour{left > 900 ? 's' : ''} for the rest, newest first.</p>}
      </div>
      {runner.running
        ? <Button variant="outline" onClick={runner.stop}><PauseCircle className="h-4 w-4 mr-1.5" /> Stop after this batch</Button>
        : left > 0 && <Button onClick={runner.all}><Sparkles className="h-4 w-4 mr-1.5" /> {counts.assessed ? 'Assess the rest' : 'Assess the library'}</Button>}
    </div>
  );
}

// ── Drive ──────────────────────────────────────────────────────────────────

const FOLDERS = ['taheri content (the shoots)', 'TC (the archive)', 'the Vault’s logos'];

export function DriveCard({ drive }: { drive: LibraryResponse['drive'] }) {
  const { toast } = useToast();
  if (drive.ok) {
    return (
      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <HardDrive className="h-3.5 w-3.5" /> Drive: {drive.images.toLocaleString('en-US')} photos from {drive.roots.map(r => r.name).join(', ') || 'the shared folders'}{drive.brand ? ` and ${drive.brand} logo files` : ''}.
      </p>
    );
  }
  const copy = () => navigator.clipboard?.writeText(drive.account).then(() => toast({ title: 'Copied' })).catch(() => undefined);
  const needApi = drive.reason === 'api-disabled';
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-2.5">
      <p className="text-sm font-semibold flex items-center gap-2"><HardDrive className="h-4 w-4" /> Your Google Drive isn’t connected yet</p>
      <p className="text-xs text-muted-foreground">Only taheri.shop’s photos are here for now. The shoots in Drive come in once the ERP may read them — two steps, each a minute, and nothing in Drive is ever changed.</p>
      <ol className="text-xs space-y-2 list-decimal pl-4">
        {needApi && (
          <li>
            Turn on the Drive API for the ERP’s Google project.{' '}
            {drive.enableUrl && <a href={drive.enableUrl} target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-0.5">Open it and press Enable <ExternalLink className="h-3 w-3" /></a>}
          </li>
        )}
        <li>
          In Drive, share {FOLDERS.join(', ')} with <button type="button" onClick={copy} className="font-mono text-[11px] rounded bg-muted px-1.5 py-0.5 inline-flex items-center gap-1 break-all min-h-0">{drive.account} <Copy className="h-3 w-3 shrink-0" /></button> as <b>Viewer</b>, without notifying.
        </li>
      </ol>
      {!needApi && drive.reason !== 'nothing-shared' && <p className="text-[11px] text-muted-foreground">Drive said: {drive.message}</p>}
    </div>
  );
}

// ── A tile ─────────────────────────────────────────────────────────────────

export function AssetTile({ item, onOpen, rank }: { item: LibraryItem; onOpen: (i: LibraryItem) => void; rank?: number }) {
  const a = item.assessment;
  const risky = !!a && (a.brandRisks.length > 0 || a.burnedText);
  return (
    <button type="button" onClick={() => onOpen(item)} className="group text-left rounded-xl border bg-card overflow-hidden hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary">
      <div className="relative">
        <AuthedImg src={item.thumb} alt={item.name} className="aspect-square" />
        <div className="absolute left-1.5 top-1.5 flex gap-1">
          {rank !== undefined && <span className="rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">#{rank}</span>}
          <ScoreBadge n={item.adScore} />
        </div>
        <span className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1" title={item.source === 'site' ? 'taheri.shop' : 'Google Drive'}>
          {item.source === 'site' ? <Globe className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
        </span>
        <div className="absolute left-1.5 bottom-1.5 flex gap-1">
          {item.usedInAds && <span className="rounded-full bg-sky-600 text-white px-1.5 py-0.5 text-[10px]">In an ad</span>}
          {risky && <span className="rounded-full bg-rose-600 text-white px-1.5 py-0.5 text-[10px] inline-flex items-center gap-0.5"><ShieldAlert className="h-2.5 w-2.5" />{a!.brandRisks.length ? 'Rule' : 'Label'}</span>}
        </div>
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-xs font-medium truncate">{item.name}</p>
        <p className="text-[11px] text-muted-foreground truncate">{a ? a.subject : item.collection}</p>
        {a && a.fixes.length > 0 && <p className="text-[10px] text-primary truncate">{a.fixes.map(f => FIXES[f].label).join(' · ')}</p>}
      </div>
    </button>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2.5">{children}</div>;

// ── Picks ──────────────────────────────────────────────────────────────────

export function PicksSection({ placement, onPlacement, onOpen, reloadKey }: { placement: Placement; onPlacement: (p: Placement) => void; onOpen: (i: LibraryItem) => void; reloadKey: number }) {
  const { data, error, loading, reload } = useLibrary(`view=picks&placement=${placement}&limit=24`);
  const newest = useLibrary(`view=all&placement=${placement}&limit=24`);
  const refresh = useCallback(() => { reload(); newest.reload(); }, [reload, newest.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (reloadKey) refresh(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const runner = useAssessRunner(refresh);
  const counts = data?.counts;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PlacementPicker value={placement} onChange={onPlacement} />
        <Button variant="ghost" size="sm" onClick={() => reload(true)} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1', loading && 'animate-spin')} /> Look again</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data?.siteError && <p className="text-xs text-amber-700">taheri.shop didn’t answer: {data.siteError}</p>}
      {counts && <AssessBar counts={counts} runner={runner} big={counts.assessed === 0} />}
      {data && <DriveCard drive={data.drive} />}
      {loading && !data ? (
        <div className="py-16 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Gathering the photos…</div>
      ) : data && data.items.length > 0 ? (
        <section className="space-y-2">
          <div>
            <h2 className="text-base font-semibold">The best for {PLACEMENT_LABEL[placement]}</h2>
            <p className="text-xs text-muted-foreground">Ranked as ads: fit for this frame first, then the photograph; anything against the house’s rules held back, pieces already running in an ad last, no collection more than a few times.</p>
          </div>
          <Grid>{data.items.map((it, i) => <AssetTile key={it.id} item={it} onOpen={onOpen} rank={i + 1} />)}</Grid>
        </section>
      ) : data && (
        <section className="space-y-2">
          <div>
            <h2 className="text-base font-semibold">The newest photos</h2>
            <p className="text-xs text-muted-foreground">{counts?.assessed ? 'None of the photos looked at so far scores 40 or more for this frame.' : 'Nothing has been looked at yet — the picks appear here as the model works through the library.'} Open any photo to assess it on its own.</p>
          </div>
          <Grid>{(newest.data?.items ?? []).map(it => <AssetTile key={it.id} item={it} onOpen={onOpen} />)}</Grid>
        </section>
      )}
    </div>
  );
}

// ── Library ────────────────────────────────────────────────────────────────

const FILTERS = [
  ['all', 'Everything'], ['assessed', 'Assessed'], ['unassessed', 'Not yet'], ['fixable', 'Has fixes'], ['risky', 'Against a rule / labelled'],
] as const;

export function LibrarySection({ placement, onPlacement, onOpen, reloadKey }: { placement: Placement; onPlacement: (p: Placement) => void; onOpen: (i: LibraryItem) => void; reloadKey: number }) {
  const [source, setSource] = useState<'all' | 'site' | 'drive'>('all');
  const [filter, setFilter] = useState<string>('all');
  const [collection, setCollection] = useState('');
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState('');
  const [sort, setSort] = useState<'newest' | 'score'>('newest');
  const [pages, setPages] = useState(1);
  useEffect(() => { const t = setTimeout(() => setQ(typed), 300); return () => clearTimeout(t); }, [typed]);
  useEffect(() => setPages(1), [source, filter, collection, q, sort, placement]);
  const query = useMemo(() => new URLSearchParams({ view: 'all', placement, source, filter, collection, q, sort, offset: '0', limit: String(60 * pages) }).toString(), [placement, source, filter, collection, q, sort, pages]);
  const { data, error, loading, reload } = useLibrary(query);
  useEffect(() => { if (reloadKey) reload(); }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const runner = useAssessRunner(reload);
  const shownUnassessed = (data?.items ?? []).filter(i => !i.assessment).map(i => i.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <PlacementPicker value={placement} onChange={onPlacement} />
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search — emerald, bangle, a collection…" className="pl-8 h-9 text-base sm:text-sm" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(['all', 'site', 'drive'] as const).map(s => (
          <button key={s} type="button" onClick={() => setSource(s)} className={cn('rounded-full border px-3 py-1 text-xs min-h-0', source === s ? 'bg-foreground text-background' : 'text-muted-foreground')}>
            {s === 'all' ? 'Both' : s === 'site' ? 'taheri.shop' : 'Drive'}
          </button>
        ))}
        <span className="w-px bg-border mx-1" />
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cn('rounded-full border px-3 py-1 text-xs min-h-0', filter === k ? 'bg-foreground text-background' : 'text-muted-foreground')}>{label}</button>
        ))}
        <span className="w-px bg-border mx-1" />
        <button type="button" onClick={() => setSort(sort === 'newest' ? 'score' : 'newest')} className="rounded-full border px-3 py-1 text-xs min-h-0 text-muted-foreground">{sort === 'newest' ? 'Newest first' : 'Best score first'}</button>
        {data && data.collections.length > 1 && (
          <select value={collection} onChange={e => setCollection(e.target.value)} className="rounded-full border bg-background px-3 py-1 text-xs h-7">
            <option value="">Every collection</option>
            {data.collections.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
          </select>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{data.total.toLocaleString('en-US')} photo{data.total === 1 ? '' : 's'}</span>
          {shownUnassessed.length > 0 && (
            <Button size="sm" variant="outline" disabled={runner.running} onClick={() => runner.these(shownUnassessed.slice(0, 60))}>
              {runner.running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />} Assess the {Math.min(60, shownUnassessed.length)} shown
            </Button>
          )}
        </div>
      )}
      {loading && !data ? <div className="py-16 text-center text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Gathering the photos…</div>
        : <Grid>{(data?.items ?? []).map(it => <AssetTile key={it.id} item={it} onOpen={onOpen} />)}</Grid>}
      {data && data.items.length < data.total && (
        <div className="text-center"><Button variant="outline" onClick={() => setPages(p => p + 1)} disabled={loading}>{loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Show more</Button></div>
      )}
    </div>
  );
}

// ── One photograph ─────────────────────────────────────────────────────────

interface Edit { blob: Blob; url: string; label: string; check: FixResult['check']; tidy: boolean }
/** The fixes whose prompt takes burned-in labels and marks off the photo. */
const TIDIES: FixCode[] = ['clear-labels', 'extend-portrait', 'extend-story', 'restage'];

export function AssetSheet({ item, placement, onClose, onMake, onChanged }: {
  item: LibraryItem | null; placement: Placement; onClose: () => void; onMake: (w: WorkPhoto) => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [shown, setShown] = useState<LibraryItem | null>(item);
  const [photo, setPhoto] = useState<{ id: string; blob: Blob; url: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Edit[]>([]);
  const [view, setView] = useState<number>(-1);
  const [busy, setBusy] = useState<string | null>(null);
  const [scenes, setScenes] = useState(false);
  const [assessing, setAssessing] = useState(false);

  useEffect(() => { setShown(item); }, [item]);
  useEffect(() => {
    setEdits(prev => { prev.forEach(e => URL.revokeObjectURL(e.url)); return []; });
    setView(-1); setScenes(false); setPhotoError(null);
    if (!item) return;
    let alive = true;
    fetchAsset(item.id, 2048).then(blob => {
      if (!alive) return;
      const url = URL.createObjectURL(blob);
      setPhoto(prev => { if (prev) URL.revokeObjectURL(prev.url); return { id: item.id, blob, url }; });
    }).catch(e => alive && setPhotoError(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = shown;
  const a = cur?.assessment ?? null;
  const base = photo && cur && photo.id === cur.id ? photo : null;
  const current = view >= 0 ? edits[view] : null;
  const working = current?.blob ?? base?.blob ?? null;

  const fix = async (code: Exclude<FixCode, 'crop-tighter'>, extra: Record<string, unknown> = {}) => {
    if (!working || busy) return;
    const f = FIX_OPS[code];
    setBusy(code); setScenes(false);
    try {
      const r = await runImageOp(working, f.op, { ...f.params, ...extra });
      const url = URL.createObjectURL(r.blob);
      const label = code === 'restage' && extra.sceneId ? `${FIXES.restage.label}: ${SCENES.find(s => s.id === extra.sceneId)?.label ?? ''}` : FIXES[code].label;
      const tidy = TIDIES.includes(code) || !!current?.tidy;
      setEdits(prev => { const next = [...prev, { blob: r.blob, url, label, check: r.check, tidy }]; setView(next.length - 1); return next; });
      toast({ title: `${label} — done`, description: r.check && !r.check.samePiece ? 'The check thinks the piece changed — look closely before using it.' : 'Compare it with the original below.' });
    } catch (e) {
      toast({ title: `${FIXES[code].label} didn’t work`, description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const assess = async () => {
    if (!cur) return;
    setAssessing(true);
    try {
      const r = await api<AssessAnswer>('/api/ads/studio/assess', { body: { ids: [cur.id], force: !!a, budgetMs: 90_000 } });
      if (!r.done.length) throw new Error(r.stopped || r.failed[0]?.error || 'The model gave no answer for it.');
      const d = await api<LibraryResponse>(`/api/ads/studio/library?view=all&placement=${placement}&id=${encodeURIComponent(cur.id)}`);
      const next = d.items.find(i => i.id === cur.id);
      if (next) setShown(next);
      onChanged();
    } catch (e) {
      toast({ title: 'Couldn’t assess it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setAssessing(false); }
  };

  const suggested = (a?.fixes ?? []).filter((f): f is Exclude<FixCode, 'crop-tighter'> => f !== 'crop-tighter');
  const others = (Object.keys(FIX_OPS) as Exclude<FixCode, 'crop-tighter'>[]).filter(f => !suggested.includes(f));

  return (
    <Sheet open={!!item} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="glass-window w-full sm:max-w-2xl overflow-y-auto p-0">
        {cur && (
          <div className="p-4 sm:p-5 space-y-4">
            <SheetHeader className="text-left pr-8">
              <SheetTitle className="text-lg">{cur.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1">{cur.source === 'site' ? <Globe className="h-3.5 w-3.5" /> : <HardDrive className="h-3.5 w-3.5" />}{cur.collection}</span>
                {cur.page && <a href={cur.page} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5">On the website <ExternalLink className="h-3 w-3" /></a>}
                {cur.usedInAds && <span className="rounded-full bg-sky-600 text-white px-2 py-0.5 text-[10px]">Already in an ad</span>}
              </SheetDescription>
            </SheetHeader>

            <div className="relative rounded-xl border bg-muted overflow-hidden">
              {photoError ? <p className="p-6 text-sm text-destructive">{photoError}</p>
                : (current?.url ?? base?.url) ? <img src={current?.url ?? base!.url} alt={cur.name} className="w-full max-h-[60vh] object-contain" />
                  : <div className="aspect-square flex items-center justify-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Fetching the photo…</div>}
              {busy && <div className="absolute inset-0 bg-background/70 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 text-sm"><Loader2 className="h-5 w-5 animate-spin" /> {FIXES[busy as FixCode]?.label}… {FIX_OPS[busy as keyof typeof FIX_OPS]?.secs}</div>}
            </div>
            {edits.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button type="button" onClick={() => setView(-1)} className={cn('shrink-0 rounded-full border px-3 py-1 text-xs min-h-0', view === -1 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>Original</button>
                {edits.map((e, i) => <button key={i} type="button" onClick={() => setView(i)} className={cn('shrink-0 rounded-full border px-3 py-1 text-xs min-h-0', view === i ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{i + 1}. {e.label}</button>)}
              </div>
            )}
            {current?.check && (
              <p className={cn('text-xs rounded-lg p-2', current.check.samePiece ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-800 dark:text-rose-300')}>
                {current.check.samePiece ? <><CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />The check says it is the same piece.</> : <><AlertTriangle className="h-3.5 w-3.5 inline mr-1" />The check thinks the piece changed: {current.check.differences.join('; ') || 'look closely'}.</>}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button disabled={!base} onClick={() => onMake({ asset: cur, blob: current?.blob ?? null, note: current?.label, clean: current?.tidy })}><Brush className="h-4 w-4 mr-1.5" /> Make an ad with {current ? 'this version' : 'it'}</Button>
              <Button variant="outline" disabled={!working} onClick={() => working && downloadBlob(working, `${safeName(cur.name)}${current ? '-' + safeName(current.label) : ''}.jpg`)}><Download className="h-4 w-4 mr-1.5" /> Download</Button>
              <Button variant="ghost" disabled={assessing} onClick={assess}>{assessing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}{a ? 'Assess again' : 'Assess it'}</Button>
            </div>

            {a ? (
              <>
                <section className="rounded-xl border p-3 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="text-center">
                      <ScoreBadge n={a.score} className="text-base px-3 py-1" />
                      <p className="text-[10px] text-muted-foreground mt-1">as it stands</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{scoreWord(a.score)}</p>
                      <p className="text-xs text-muted-foreground">{a.subject}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{[a.category, a.shot.replace('-', ' '), `${a.background} background`].join(' · ')}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {PLACEMENTS.map(p => (
                      <div key={p} className={cn('rounded-lg border p-2 text-center', p === placement && 'border-primary')}>
                        <p className="text-[10px] text-muted-foreground">{PLACEMENT_LABEL[p]}</p>
                        <p className="text-lg font-semibold tabular-nums">{a.placements[p]}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <Meter label="Sharpness" value={a.quality.sharpness} />
                    <Meter label="Lighting" value={a.quality.lighting} />
                    <Meter label="Composition" value={a.quality.composition} />
                    <Meter label="Colour" value={a.quality.colour} />
                  </div>
                </section>

                {(a.brandRisks.length > 0 || a.burnedText) && (
                  <section className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3 space-y-1">
                    <p className="text-sm font-semibold flex items-center gap-1.5"><ShieldAlert className="h-4 w-4 text-rose-600" /> Against the house’s rules as it is</p>
                    <ul className="text-xs list-disc pl-4 space-y-0.5">
                      {a.burnedText && <li>Text on the photo itself (a weight, a label or a mark) — an ad never shows a weight; “Clear old labels” takes it off.</li>}
                      {a.brandRisks.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </section>
                )}

                <section className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border p-3"><p className="text-xs font-semibold mb-1">Works</p><ul className="text-xs list-disc pl-4 space-y-0.5">{a.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                  <div className="rounded-xl border p-3"><p className="text-xs font-semibold mb-1">Holds it back</p><ul className="text-xs list-disc pl-4 space-y-0.5">{a.issues.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                </section>
                {a.headline && <p className="text-xs"><span className="text-muted-foreground">A line for it: </span><span className="font-serif italic text-sm">“{a.headline}”</span></p>}
              </>
            ) : (
              <p className="text-xs text-muted-foreground rounded-xl border p-3">Not assessed yet. “Assess it” scores it as an ad in about half a minute; the fixes work either way.</p>
            )}

            <section className="space-y-2">
              <p className="text-sm font-semibold flex items-center gap-1.5"><Wand2 className="h-4 w-4" /> Fix it{current ? ` (from ${current.label})` : ''}</p>
              <p className="text-[11px] text-muted-foreground">Each fix is the same AI Post a Piece uses, checked afterwards against the photo it came from. Fixes build on the version shown.</p>
              <div className="flex flex-wrap gap-2">
                {suggested.map(f => <FixButton key={f} code={f} busy={busy} disabled={!working} onRun={() => (f === 'restage' ? setScenes(s => !s) : fix(f))} primary />)}
                {a?.fixes.includes('crop-tighter') && <Button size="sm" onClick={() => base && onMake({ asset: cur, blob: current?.blob ?? null, note: current?.label, clean: current?.tidy })}><Crop className="h-4 w-4 mr-1" /> Crop tighter in the maker</Button>}
                {others.map(f => <FixButton key={f} code={f} busy={busy} disabled={!working} onRun={() => (f === 'restage' ? setScenes(s => !s) : fix(f))} />)}
              </div>
              {scenes && (
                <div className="rounded-xl border p-2 grid sm:grid-cols-2 gap-1.5">
                  {SCENES.map(s => (
                    <button key={s.id} type="button" onClick={() => fix('restage', { sceneId: s.id })} className="rounded-lg border p-2 text-left hover:border-primary/60">
                      <p className="text-xs font-medium">{s.label}</p>
                      <p className="text-[10px] text-muted-foreground">Suits {s.suits}</p>
                    </button>
                  ))}
                </div>
              )}
              {a?.fixes.length ? (
                <ul className="text-[11px] text-muted-foreground space-y-0.5">{a.fixes.map(f => <li key={f}><b className="text-foreground/80">{FIXES[f].label}:</b> {FIXES[f].why}</li>)}</ul>
              ) : null}
            </section>
            {cur.source === 'drive' && <p className="text-[11px] text-muted-foreground flex items-center gap-1"><ImageIcon className="h-3 w-3" /> From Drive. Nothing here changes the file in Drive.</p>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FixButton({ code, busy, disabled, onRun, primary }: { code: Exclude<FixCode, 'crop-tighter'>; busy: string | null; disabled: boolean; onRun: () => void; primary?: boolean }) {
  return (
    <Button size="sm" variant={primary ? 'default' : 'outline'} disabled={disabled || !!busy} onClick={onRun} title={FIXES[code].why}>
      {busy === code ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}{FIXES[code].label}
    </Button>
  );
}
