'use client';

/**
 * Posts › Stories: the house's running order of website pieces as Instagram stories, one a day (the owner,
 * 2026-10-27: "make 50 more and add them to a stories draft tab in the erp"). lib/social/story-drafts.ts holds the
 * order and what each piece is; the site gives its name and weight as they are now; week-story.ts draws each story
 * here, 2160 × 3840, never sharpened. A draft is posted to Instagram from here (the server sizes it for Instagram),
 * or saved and shared by hand, then marked posted; one that should not go out is skipped.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Camera, Check, Download, Instagram, Loader2, RotateCcw, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { diagnose } from '@/lib/social/diagnose';
import { loadImage } from '@/lib/social/story';
import { STORE_MARK_SVG } from '@/lib/store-config';
import { FONTS } from '@/app/website/post/fonts';
import { storyDay, type StoryDraft, type StoryDraftStatus } from '@/lib/social/story-drafts';
import { loadWeekStoryFonts, weekStoryJpeg, type WeekStoryFonts } from '@/lib/social/week-story';

type Filter = 'todo' | 'posted' | 'skipped' | 'all';
interface IgStatus { configured: boolean; connected: boolean; username: string | null }

const STORY_FONTS: WeekStoryFonts = { serif: FONTS.serif, italic: FONTS.extra?.cormorant ?? FONTS.serif, caps: FONTS.extra?.tenor ?? FONTS.body };

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fileName = (d: StoryDraft) => `${String(d.n).padStart(2, '0')}-${slug(d.name)}${d.weight ? `-${d.weight}g` : ''}-story.jpg`;

export default function StoryDraftsPage() {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<StoryDraft[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('todo');
  const [open, setOpen] = useState<StoryDraft | null>(null);
  const [ig, setIg] = useState<IgStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Small previews (½ size) by id, and the full stories once made; a photo is fetched once.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const photos = useRef(new Map<string, Promise<HTMLImageElement>>());
  const mark = useRef<Promise<HTMLImageElement | null> | null>(null);
  const full = useRef(new Map<string, Blob>());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/posts/story-drafts', { headers: await authHeaders(), cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `${res.status}`);
      setDrafts(d.drafts);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => {
    load();
    (async () => {
      const r = await fetch('/api/instagram/status', { headers: await authHeaders(), cache: 'no-store' }).catch(() => null);
      if (r?.ok) setIg(await r.json().catch(() => null));
    })();
  }, [load]);

  const photoOf = useCallback((id: string) => {
    let p = photos.current.get(id);
    if (!p) {
      p = (async () => {
        const res = await fetch(`/api/website/site-pieces/image?id=${encodeURIComponent(id)}&size=3000`, { headers: await authHeaders() });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The photograph didn’t come (${res.status}).`);
        return loadImage(await res.blob());
      })();
      p.catch(() => photos.current.delete(id));
      photos.current.set(id, p);
    }
    return p;
  }, []);

  const make = useCallback(async (d: StoryDraft, scale: number) => {
    mark.current ??= loadImage(STORE_MARK_SVG).catch(() => null);
    const [photo, wordmark] = await Promise.all([photoOf(d.id), mark.current, loadWeekStoryFonts(STORY_FONTS)]);
    return weekStoryJpeg(photo, { kind: d.kind, name: d.name, weight: d.weight }, STORY_FONTS, wordmark, scale, scale < 1 ? 0.82 : 0.92);
  }, [photoOf]);

  /** The full story (2160 × 3840), made once. */
  const fullStory = useCallback(async (d: StoryDraft) => {
    const have = full.current.get(d.id);
    if (have) return have;
    const b = await make(d, 2);
    full.current.set(d.id, b);
    return b;
  }, [make]);

  // Previews as cards come into view, a few at a time.
  const wanted = useRef(new Set<string>());
  const making = useRef(0);
  const pump = useCallback(() => {
    if (!drafts) return;
    while (making.current < 3) {
      const id = [...wanted.current].find(x => !previews[x] && !failed[x]);
      if (!id) return;
      wanted.current.delete(id);
      const d = drafts.find(x => x.id === id);
      if (!d || d.missing) continue;
      making.current++;
      make(d, 0.5)
        .then(b => setPreviews(p => ({ ...p, [id]: URL.createObjectURL(b) })))
        .catch(e => { console.error('[stories] preview', id, e); setFailed(f => ({ ...f, [id]: e instanceof Error ? e.message : String(e) })); })
        .finally(() => { making.current--; pump(); });
    }
  }, [drafts, make, previews, failed]);
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    observer.current = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { const id = (e.target as HTMLElement).dataset.id; if (id) wanted.current.add(id); }
      pump();
    }, { rootMargin: '400px' });
    document.querySelectorAll('[data-story-card]').forEach(el => observer.current!.observe(el));
    return () => observer.current?.disconnect();
  }, [drafts, filter, pump]);

  const setStatus = async (d: StoryDraft, status: StoryDraftStatus | null) => {
    setBusy(`status:${d.id}`);
    try {
      const res = await fetch('/api/posts/story-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ id: d.id, status }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || `${res.status}`);
      setDrafts(list => (list ?? []).map(x => (x.id === d.id ? r.draft ?? x : x)));
      setOpen(o => (o?.id === d.id ? r.draft ?? o : o));
    } catch (e) {
      toast({ title: 'Couldn’t save that', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const save = async (d: StoryDraft) => {
    setBusy(`save:${d.id}`);
    try {
      const file = new File([await fullStory(d)], fileName(d), { type: 'image/jpeg' });
      try {
        if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      } catch (e) { if ((e as Error).name === 'AbortError') return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      toast({ title: 'Couldn’t make the story', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const post = async (d: StoryDraft) => {
    setBusy(`post:${d.id}`);
    try {
      const form = new FormData();
      form.set('file', new File([await fullStory(d)], fileName(d), { type: 'image/jpeg' }));
      const res = await fetch('/api/instagram/story', { method: 'POST', headers: await authHeaders(), body: form });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(r.error || `${res.status}`), { status: res.status });
      toast({ title: `Story posted${ig?.username ? ` to @${ig.username}` : ''}`, description: d.name });
      setBusy(null);
      await setStatus(d, 'posted');
    } catch (e) {
      const dg = diagnose('instagram', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
      toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  const counts = useMemo(() => {
    const c = { todo: 0, posted: 0, skipped: 0, all: drafts?.length ?? 0 };
    for (const d of drafts ?? []) { if (!d.state) c.todo++; else c[d.state.status]++; }
    return c;
  }, [drafts]);
  const shown = useMemo(() => (drafts ?? []).filter(d => filter === 'all' || (filter === 'todo' ? !d.state : d.state?.status === filter)), [drafts, filter]);
  const next = useMemo(() => (drafts ?? []).find(d => !d.state && !d.missing) ?? null, [drafts]);
  const [openUrl, setOpenUrl] = useState('');
  useEffect(() => {
    if (!open) { setOpenUrl(''); return; }
    let url = '', gone = false;
    fullStory(open).then(b => { if (!gone) { url = URL.createObjectURL(b); setOpenUrl(url); } }).catch(() => undefined);
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [open, fullStory]);

  const label: Record<Filter, string> = { todo: 'To post', posted: 'Posted', skipped: 'Skipped', all: 'All' };
  const canPost = !!ig?.connected;

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-5 pb-24 lg:pb-6">
      <div className="min-w-0">
        <h1 className="flex items-center text-ios-large font-bold text-foreground md:text-3xl md:font-semibold"><Camera className="mr-3 hidden h-7 w-7 text-primary md:block" /> Stories</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A story a day from the website’s pieces, its name and weight as the site has them now. Post it to Instagram from here, or save it and post it yourself, then mark it posted.
        </p>
      </div>

      {error && <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {next && (
        <button type="button" onClick={() => setOpen(next)} className="flex w-full items-center justify-between gap-3 rounded-[22px] bg-card p-4 text-left">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next up · {storyDay(next.n)}</p>
            <p className="truncate font-medium">{next.name}{next.weight ? ` · ${next.weight}g` : ''}</p>
          </div>
          <span className="shrink-0 text-sm text-muted-foreground">Open</span>
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        {(['todo', 'posted', 'skipped', 'all'] as Filter[]).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn('rounded-full px-3.5 py-1.5 text-sm', filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
            {label[f]} <span className="opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {!drafts && !error && <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Reading the website…</p>}
      {drafts && !shown.length && <p className="text-sm text-muted-foreground">Nothing here.</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map(d => (
          <button key={d.id} type="button" data-story-card data-id={d.id} onClick={() => setOpen(d)}
            className="group overflow-hidden rounded-[22px] bg-card text-left">
            <div className="relative aspect-[9/16] bg-muted">
              {previews[d.id]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={previews[d.id]} alt={d.name} className="h-full w-full object-cover" />
                : <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">{d.missing ? 'Not on the website now' : failed[d.id] ? `Couldn’t draw it: ${failed[d.id]}` : <Loader2 className="h-4 w-4 animate-spin" />}</div>}
              {d.state && (
                <span className={cn('absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold', d.state.status === 'posted' ? 'bg-emerald-600 text-white' : 'bg-black/60 text-white')}>
                  {d.state.status === 'posted' ? 'Posted' : 'Skipped'}
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="text-[11px] text-muted-foreground">{d.n} · {storyDay(d.n)}</p>
              <p className="truncate text-sm font-medium">{d.name}</p>
              <p className="text-xs text-muted-foreground">{d.weight ? `${d.weight}g` : 'No weight on the site'}</p>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!open} onOpenChange={o => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-md">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.name}</DialogTitle>
                <DialogDescription>{open.n} · {storyDay(open.n)} · {open.kind}{open.weight ? ` · ${open.weight}g` : ''}</DialogDescription>
              </DialogHeader>
              {/* As tall as leaves room for the buttons on a phone, at most 300 × 533. */}
              <div className="mx-auto aspect-[9/16] h-[min(533px,52vh)] shrink-0 overflow-hidden rounded-xl bg-muted">
                {openUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={openUrl} alt={open.name} className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{open.missing ? 'Not on the website now' : <Loader2 className="h-5 w-5 animate-spin" />}</div>}
              </div>
              {open.missing && <p className="text-sm text-muted-foreground">This piece is hidden or gone from the website, so there is no photograph to make it from.</p>}
              {!open.missing && !open.weight && <p className="text-sm text-muted-foreground">The site has no weight for this piece; add it on Website › Photo weights and it shows here.</p>}
              <div className="grid grid-cols-2 gap-2">
                {canPost && (
                  <Button className="col-span-2" disabled={!!busy || open.missing} onClick={() => post(open)}>
                    {busy === `post:${open.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Instagram className="mr-2 h-4 w-4" />}Post to Instagram{ig?.username ? ` @${ig.username}` : ''}
                  </Button>
                )}
                <Button variant="outline" disabled={!!busy || open.missing} onClick={() => save(open)}>
                  {busy === `save:${open.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Save
                </Button>
                {open.state
                  ? <Button variant="outline" disabled={!!busy} onClick={() => setStatus(open, null)}><RotateCcw className="mr-2 h-4 w-4" />Back to drafts</Button>
                  : <Button variant="outline" disabled={!!busy} onClick={() => setStatus(open, 'posted')}><Check className="mr-2 h-4 w-4" />Mark posted</Button>}
                {!open.state && (
                  <Button variant="ghost" className="col-span-2" disabled={!!busy} onClick={() => setStatus(open, 'skipped')}><SkipForward className="mr-2 h-4 w-4" />Skip this one</Button>
                )}
              </div>
              {open.state && <p className="text-xs text-muted-foreground">{open.state.status === 'posted' ? 'Posted' : 'Skipped'} {new Date(open.state.at).toLocaleString()}{open.state.by ? ` by ${open.state.by}` : ''}.</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
