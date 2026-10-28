'use client';

/**
 * Posts › Stories: the house's running order of website pieces as Instagram stories, one a day (the owner,
 * 2026-10-27: "make 50 more and add them to a stories draft tab in the erp"). lib/social/story-drafts.ts holds the
 * order and what each piece is; the site gives its name and weight as they are now; week-story.ts draws each story
 * here, 2160 × 3840, never sharpened. A draft is posted to Instagram from here (the server sizes it for Instagram),
 * sent to the WhatsApp community's groups and the channel (2026-10-28, through /api/website/post, so the "- II"
 * twins get it too), or saved and shared by hand, then marked posted; one that should not go out is skipped.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Camera, Check, Download, Instagram, Loader2, MessageCircle, RotateCcw, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { diagnose } from '@/lib/social/diagnose';
import { loadImage } from '@/lib/social/story';
import { STORE_MARK_SVG, STORE_WHATSAPP_NUMBERS } from '@/lib/store-config';
import { FONTS } from '@/app/website/post/fonts';
import { storyCaption, storyDay, type StoryDraft, type StoryDraftPlace, type StoryDraftStatus } from '@/lib/social/story-drafts';
import { loadWeekStoryFonts, weekStoryJpeg, type WeekStoryFonts } from '@/lib/social/week-story';

type Filter = 'todo' | 'posted' | 'skipped' | 'all';
interface IgStatus { configured: boolean; connected: boolean; username: string | null }
/** A WhatsApp place a story can go to: a group of the community, or the channel (GET /api/website/post). */
interface WaPlace { key: string; name: string; size: number | null }
type WaInfo = { places: WaPlace[] } | { none: true } | { error: string };

/** The places chosen last time, on this device. */
const WA_PICK_KEY = 'stories_whatsapp_places';
const readPick = (): string[] => { try { return JSON.parse(localStorage.getItem(WA_PICK_KEY) || '[]'); } catch { return []; } };
const writePick = (keys: string[]) => { try { localStorage.setItem(WA_PICK_KEY, JSON.stringify(keys)); } catch { /* private mode */ } };
const PLACE_LABEL: Record<StoryDraftPlace, string> = { instagram: 'Instagram', whatsapp: 'WhatsApp' };

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
  const [wa, setWa] = useState<WaInfo | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [caption, setCaption] = useState('');

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

  const setStatus = (d: StoryDraft, status: StoryDraftStatus | null) => record(d, { status });
  /** Keep what happened to a draft: a status, or where it went (POST /api/posts/story-drafts). */
  const record = async (d: StoryDraft, what: { status: StoryDraftStatus | null } | { sent: StoryDraftPlace; to?: string[] }) => {
    setBusy(`status:${d.id}`);
    try {
      const res = await fetch('/api/posts/story-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ id: d.id, ...what }) });
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
      await record(d, { sent: 'instagram' });
    } catch (e) {
      const dg = diagnose('instagram', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
      toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
    } finally { setBusy(null); }
  };

  // The community's groups and the channel, asked once a story is opened (it reaches WhatsApp, so not on load).
  useEffect(() => {
    if (!open || wa) return;
    (async () => {
      try {
        const res = await fetch('/api/website/post', { headers: await authHeaders(), cache: 'no-store' });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || `${res.status}`);
        if (!d.community) { setWa({ none: true }); return; }
        const places: WaPlace[] = [
          // By the shop's own labels (Announcements, Diamonds …): the community and its channel share one name.
          ...(d.groups ?? []).map((g: { key: string; label: string; size: number | null }) => ({ key: g.key, name: g.label, size: g.size })),
          ...(d.channel ? [{ key: 'channel', name: 'Channel', size: d.channel.followers }] : []),
        ];
        setWa({ places });
        const saved = readPick().filter(k => places.some(p => p.key === k));
        setPick(saved.length ? saved : places.slice(0, 1).map(p => p.key));
      } catch (e) { setWa({ error: e instanceof Error ? e.message : String(e) }); }
    })();
  }, [open, wa]);
  useEffect(() => { if (open) setCaption(storyCaption(open, STORE_WHATSAPP_NUMBERS)); }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePlace = (key: string) => setPick(p => { const next = p.includes(key) ? p.filter(k => k !== key) : [...p, key]; writePick(next); return next; });

  const sendWa = async (d: StoryDraft) => {
    if (!pick.length) return;
    setBusy(`wa:${d.id}`);
    try {
      const form = new FormData();
      form.set('file', new File([await fullStory(d)], fileName(d), { type: 'image/jpeg' }));
      if (caption.trim()) form.set('caption', caption.trim());
      form.set('targets', pick.join(','));
      form.set('sitePiece', d.id);
      const res = await fetch('/api/website/post', { method: 'POST', headers: await authHeaders(), body: form });
      const r = await res.json().catch(() => ({})) as { error?: string; results?: { key: string; label: string; ok: boolean; error?: string }[] };
      const results = r.results ?? [];
      const went = results.filter(x => x.ok);
      const failed = results.filter(x => !x.ok);
      if (!res.ok && !went.length) throw Object.assign(new Error(r.error || `${res.status}`), { status: res.status });
      toast({
        title: `Sent to ${went.map(x => x.label).join(', ')}`,
        description: failed.length ? `Didn’t go to ${failed.map(x => `${x.label} (${x.error || 'failed'})`).join('; ')}.` : d.name,
        ...(failed.length ? { variant: 'destructive' as const } : {}),
      });
      setBusy(null);
      await record(d, { sent: 'whatsapp', to: went.map(x => x.key) });
    } catch (e) {
      const dg = diagnose('whatsapp', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
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

  const placeName = (key: string) => (wa && 'places' in wa ? wa.places.find(p => p.key === key)?.name : undefined) ?? key;
  const label: Record<Filter, string> = { todo: 'To post', posted: 'Posted', skipped: 'Skipped', all: 'All' };
  const canPost = !!ig?.connected;

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-5 pb-24 lg:pb-6">
      <div className="min-w-0">
        <h1 className="flex items-center text-ios-large font-bold text-foreground md:text-3xl md:font-semibold"><Camera className="mr-3 hidden h-7 w-7 text-primary md:block" /> Stories</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A story a day from the website’s pieces, its name and weight as the site has them now. Post it to Instagram or the WhatsApp community from here, or save it and post it yourself, then mark it posted.
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
                  {d.state.status === 'posted' ? ['Posted', ...(d.state.on ?? []).map(p => PLACE_LABEL[p])].join(' · ') : 'Skipped'}
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
              {open.state && (
                <p className="text-xs text-muted-foreground">
                  {open.state.status === 'posted' ? 'Posted' : 'Skipped'} {new Date(open.state.at).toLocaleString()}{open.state.by ? ` by ${open.state.by}` : ''}.
                  {open.state.on?.length ? ` Went to ${open.state.on.map(p => p === 'whatsapp' && open.state?.whatsapp?.length ? `WhatsApp (${open.state.whatsapp.map(k => placeName(k)).join(', ')})` : PLACE_LABEL[p]).join(' and ')}.` : ''}
                </p>
              )}
              {!open.missing && (
                <div className="space-y-2 rounded-2xl bg-muted/50 p-3">
                  <p className="flex items-center text-sm font-medium"><MessageCircle className="mr-2 h-4 w-4 text-emerald-600" />WhatsApp community</p>
                  {!wa && <p className="flex items-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Asking WhatsApp for the groups…</p>}
                  {wa && 'none' in wa && <p className="text-xs text-muted-foreground">This shop has no WhatsApp community set.</p>}
                  {wa && 'error' in wa && <p className="text-xs text-destructive">Couldn’t read the groups: {wa.error}</p>}
                  {wa && 'places' in wa && (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {wa.places.map(p => {
                          const on = pick.includes(p.key);
                          const sent = open.state?.whatsapp?.includes(p.key);
                          return (
                            <button key={p.key} type="button" onClick={() => togglePlace(p.key)} aria-pressed={on}
                              className={cn('rounded-full px-3 py-1 text-xs', on ? 'bg-emerald-600 text-white' : 'bg-background text-foreground')}>
                              {sent && <Check className="-ml-0.5 mr-1 inline h-3 w-3" />}{p.name}{p.size ? <span className="opacity-70"> · {p.size.toLocaleString()}</span> : null}
                            </button>
                          );
                        })}
                      </div>
                      <Textarea value={caption} onChange={e => setCaption(e.target.value)} rows={5} className="text-xs" aria-label="Caption" />
                      <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" disabled={!!busy || !pick.length} onClick={() => sendWa(open)}>
                        {busy === `wa:${open.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
                        {pick.length ? `Send to ${pick.length === 1 ? placeName(pick[0]) : `${pick.length} places`}` : 'Choose where it goes'}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">A group with a twin in the second community reaches it too. A ✓ marks where this story has gone already.</p>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
