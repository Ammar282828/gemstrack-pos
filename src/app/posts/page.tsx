'use client';

/**
 * Posts — the hub (the owner, 2026-10-04: "the posts tab could be consolidated a lot better … the
 * workflows could be smoother maybe merged? while still keeping everything central. like a posting
 * hub maybe").
 *
 * The send log said how posting is really done: in the ten days before, 26 of Taheri's 37 sends and
 * all 24 of Mina's were pieces already on the website, three or four at a time within a minute or
 * two, each picked, captioned, sent and confirmed on its own; the queue made for batches had never
 * been used (it sat at the end of Post a Piece, behind a design and its five steps). So the hub is
 * built around that:
 *
 *   Today      what went out, from every path (the send log, lib/social/sent-log.ts), and where
 *              Taheri's daily gold post is — each part sent, due, or waiting on an OK
 *   The queue  what is waiting to go, with Send all and Spread over the day (Post a Piece's queue,
 *              which website pieces now join too)
 *   The site   the website's pieces (what From the website was): tap one or several; each is a card
 *              of its own in the tray (./piece-card.tsx) with its caption, weight, design and story,
 *              and one Send takes them all to the same places, one after another, after one confirm
 *              — or Queue them, to send later or spread over the day
 *   New piece  Post a Piece, for new photographs (its drafts open from here), and any website piece
 *              can be carried into it for the full designer
 *
 * Where a post goes is one choice, remembered on the device and shared with Post a Piece. The checks
 * strip (./health-panel) stands over all of it, so a broken line is seen before anything is sent.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Camera, Check, Clock, FileClock, History, Loader2, MessageCircle, Radio, Search, Send, Shuffle, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { diagnose } from '@/lib/social/diagnose';
import { loadImage } from '@/lib/social/story';
import type { Sent } from '@/lib/social/sent-log';
import { currentPostDraft, listPostDrafts, readPostPrefs, thumbOf, writePostPrefs } from '@/lib/social/post-drafts';
import { TARGET_ORDER, karachiNow, type Target } from '@/lib/investments-schedule';
import { STORE_INVESTMENTS, STORE_LINKS, STORE_POST_PIECE, STORE_SITE_POSTS } from '@/lib/store-config';
import { HealthPanel, useHealth } from '@/app/website/post/health-panel';
import { QueuePanel, useQueue, listOf } from '@/app/website/post/queue-panel';
import { PostDraftsDialog } from '@/app/website/post/post-drafts-panel';
import { PieceCard, agoLabel, slugOf, type CardHandle, type IgStatus, type Piece } from './piece-card';
import { TodayCard, type InvestmentsToday } from './today';

/** The "collection" chip for the new arrivals — what the grid opens on. */
const NEW = '__new';
const PAGE = 60;
/** Pieces posted within this many days are hidden by default and skipped by Shuffle. */
const FRESH_DAYS = 30;
/** Enough for one sitting; more is the queue's to spread. */
const MAX_PICK = 10;

interface Group { key: string; label: string; name: string; size: number | null; reachable: boolean }
interface Audience { community: { name: string; size: number | null; reachable: boolean } | null; channel: { name: string; followers: number | null } | null; groups: Group[] }

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);

export default function PostsRoute() {
  // A wrapper, so the page's own hooks never sit behind an early return.
  if (!STORE_SITE_POSTS && !STORE_POST_PIECE && !STORE_INVESTMENTS) {
    return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t post from the ERP.</p>;
  }
  return <PostsHub />;
}

function PostsHub() {
  const { toast } = useToast();
  const router = useRouter();
  const health = useHealth();
  const queue = useQueue();

  const [pieces, setPieces] = useState<Piece[] | null>(STORE_SITE_POSTS ? null : []);
  const [site, setSite] = useState('');
  const [posted, setPosted] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience>({ community: null, channel: null, groups: [] });
  const [targets, setTargets] = useState<string[]>([]);
  const [ig, setIg] = useState<IgStatus | null>(null);
  const [sent, setSent] = useState<Sent[] | null>(null);
  const [inv, setInv] = useState<InvestmentsToday | null>(null);
  const [now, setNow] = useState(() => karachiNow());

  const [q, setQ] = useState('');
  const [collection, setCollection] = useState(NEW);
  const [freshOnly, setFreshOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);

  // The tray: the pieces picked, in the order they go; the one in view; how each send went.
  const [picked, setPicked] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, { s: 'sending' | 'failed'; error?: string }>>({});
  const [busy, setBusy] = useState<'send' | 'queue' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const cards = useRef(new Map<string, CardHandle>());
  const photos = useRef(new Map<string, Blob>());
  const trayRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<HTMLDivElement>(null);
  const [sendInView, setSendInView] = useState(true);

  const [draftsOpen, setDraftsOpen] = useState(false);
  const [drafts, setDrafts] = useState<{ count: number; current: { id: string; title: string } | null }>({ count: 0, current: null });

  const loadSent = useCallback(async () => {
    try {
      const res = await fetch('/api/website/post/recent', { headers: await authHeaders(), cache: 'no-store' });
      setSent(res.ok ? (await res.json()).sent ?? [] : []);
    } catch { setSent([]); }
  }, []);
  const loadInvestments = useCallback(async () => {
    if (!STORE_INVESTMENTS) return;
    try {
      const headers = await authHeaders();
      const [pr, sr] = await Promise.all([
        fetch('/api/investments', { headers, cache: 'no-store' }),
        fetch('/api/investments/schedule', { headers, cache: 'no-store' }),
      ]);
      if (!pr.ok) return;
      const d = await pr.json();
      const s = sr.ok ? await sr.json() : null;
      const dest = s?.destinations as Record<Target, boolean> | undefined;
      setInv({
        post: (d.posts ?? []).find((p: { date: string }) => p.date === d.today) ?? null,
        schedule: s?.schedule ?? null,
        targets: TARGET_ORDER.filter(t => (dest ? dest[t] : t !== 'channel')),
      });
    } catch { /* the card just doesn't show */ }
  }, []);
  const refreshDrafts = useCallback(async () => {
    if (!STORE_POST_PIECE) return;
    const list = await listPostDrafts().catch(() => []);
    const cur = currentPostDraft();
    const c = cur ? list.find(d => d.id === cur) : undefined;
    setDrafts({ count: list.length, current: c ? { id: c.id, title: c.title } : null });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const headers = await authHeaders();
    fetch('/api/instagram/status', { headers, cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(setIg).catch(() => undefined);
    loadSent(); loadInvestments(); refreshDrafts();
    // Where posts go: the community's groups and the channel. The choice is this device's, shared with Post a Piece.
    fetch('/api/website/post', { headers, cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(a => {
      if (!a) return;
      const groups: Group[] = a.groups ?? [];
      setAudience({ community: a.community ?? null, channel: a.channel ?? null, groups });
      const keys = [...groups.map(g => g.key), ...(a.channel ? ['channel'] : [])];
      const wanted = readPostPrefs().waTargets?.filter(k => keys.includes(k));
      setTargets(wanted?.length ? wanted : [...groups.slice(0, 1).map(g => g.key), ...(a.channel ? ['channel'] : [])]);
    }).catch(() => undefined);
    if (!STORE_SITE_POSTS) return;
    try {
      const res = await fetch('/api/website/site-pieces', { headers, cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `${res.status}`);
      setPieces((d.pieces as Piece[]).filter(p => !p.hidden)); setSite(d.site); setPosted(d.posted || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadSent, loadInvestments, refreshDrafts]);
  useEffect(() => { load(); }, [load]);
  // Today keeps itself current: the clock every half minute, what went out every two, and on coming back to the tab.
  useEffect(() => {
    const clock = setInterval(() => setNow(karachiNow()), 30_000);
    const data = setInterval(() => { loadSent(); loadInvestments(); }, 120_000);
    const back = () => { if (document.visibilityState === 'visible') { loadSent(); loadInvestments(); refreshDrafts(); } };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(clock); clearInterval(data); document.removeEventListener('visibilitychange', back); };
  }, [loadSent, loadInvestments, refreshDrafts]);

  const byId = useMemo(() => new Map((pieces ?? []).map(p => [p.id, p])), [pieces]);
  const collections = useMemo(() => [...new Set((pieces ?? []).map(p => p.collection).filter(Boolean))].sort(), [pieces]);
  // A site that gives no dates has no new arrivals: the grid shows everything instead.
  const hasNew = !!pieces?.some(p => p.newArrival);
  const showing = collection === NEW && pieces && !hasNew ? '' : collection;
  const recent = (p: Piece) => !!posted[p.id] && daysAgo(posted[p.id]) < FRESH_DAYS;
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (pieces ?? []).filter(p => (showing === NEW ? p.newArrival : !showing || p.collection === showing)
      && (!freshOnly || !recent(p))
      && words.every(w => `${p.name} ${p.collection} ${p.facts.join(' ')}`.toLowerCase().includes(w)));
  }, [pieces, q, showing, freshOnly, posted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setShown(PAGE); }, [q, collection, freshOnly]);

  /** The website's photograph, fetched once through this server (the site doesn't share it with other pages). */
  const photo = useCallback(async (id: string): Promise<Blob> => {
    const have = photos.current.get(id);
    if (have) return have;
    const res = await fetch(`/api/website/site-pieces/image?id=${encodeURIComponent(id)}`, { headers: await authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The photograph didn’t come (${res.status}).`);
    const b = await res.blob();
    photos.current.set(id, b);
    return b;
  }, []);
  const register = useCallback((id: string, h: CardHandle | null) => { if (h) cards.current.set(id, h); else cards.current.delete(id); }, []);

  const toTray = () => {
    // On a phone the tray is above the grid: bring it into view. Beside the grid it is already there.
    if (window.matchMedia('(max-width: 1023px)').matches) trayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const take = (id: string) => {
    const next = picked.filter(x => x !== id);
    setPicked(next);
    if (active === id) setActive(next[next.length - 1] ?? null);
    setStates(s => { const { [id]: _, ...rest } = s; return rest; });
  };
  const toggle = (p: Piece) => {
    if (busy) return;
    if (picked.includes(p.id)) { take(p.id); return; }
    if (picked.length >= MAX_PICK) { toast({ title: `${MAX_PICK} at a time`, description: 'Send or queue these first — the queue can spread them over the day.' }); return; }
    setPicked([...picked, p.id]); setActive(p.id);
  };
  /** A piece at random from what's showing — not one posted lately, unless there are none. */
  const randomPiece = (not: string[]) => {
    const pool = filtered.filter(p => !recent(p) && !not.includes(p.id));
    const from = pool.length ? pool : filtered.filter(p => !not.includes(p.id));
    return from.length ? from[Math.floor(Math.random() * from.length)] : null;
  };
  const shuffle = () => {
    if (picked.length >= MAX_PICK) { toast({ title: `${MAX_PICK} at a time` }); return; }
    const p = randomPiece(picked);
    if (!p) { toast({ title: 'Nothing to shuffle', description: 'Clear the search or pick another collection.' }); return; }
    setPicked([...picked, p.id]); setActive(p.id); toTray();
  };
  const another = (id: string) => {
    const p = randomPiece(picked);
    if (!p) { toast({ title: 'Nothing else to shuffle to' }); return; }
    setPicked(picked.map(x => (x === id ? p.id : x))); setActive(p.id);
    setStates(s => { const { [id]: _, ...rest } = s; return rest; });
  };

  const chooseTarget = (k: string) => {
    const next = targets.includes(k) ? targets.filter(x => x !== k) : [...targets, k];
    // In the order they are offered: the groups, then the channel.
    const order = [...audience.groups.map(g => g.key), 'channel'];
    const sorted = order.filter(x => next.includes(x));
    setTargets(sorted);
    writePostPrefs({ ...readPostPrefs(), waTargets: sorted });
  };
  /** What a destination key is called on the page. */
  const labelOf = (k: string) => (k === 'channel' ? 'the channel' : audience.groups.find(g => g.key === k)?.label ?? k);
  const reachOf = (k: string) => (k === 'channel' ? audience.channel?.followers ?? null : audience.groups.find(g => g.key === k)?.size ?? null);
  /** A send log's name for a place, in the counter's words. */
  const placeName = (log: string) => log === 'whatsapp-community' ? (audience.groups.find(g => g.name === audience.community?.name)?.label || 'Announcements')
    : log === 'whatsapp-channel' ? 'Channel' : log === 'instagram-story' ? 'Instagram story'
    : log.startsWith('whatsapp-group:') ? (audience.groups.find(g => g.key === log.slice(15))?.label ?? log.slice(15)) : log;
  const blockers = (wa: boolean, ig_ = false, web = false) => (health.report?.checks ?? []).filter(c => c.status === 'fail' && (
    (c.group === 'WhatsApp' && wa) || (c.group === 'Instagram' && ig_) || (c.group === 'Website' && web)));

  const n = picked.length;
  const noun = (k: number) => (k === 1 ? 'piece' : 'pieces');
  const canSend = !!audience.community && targets.length > 0 && n > 0 && !busy;

  /** Every piece in the tray, one after another, each to the chosen places. Stops at the first that fails. */
  const send = async () => {
    const ids = picked.filter(id => cards.current.has(id) && byId.has(id));
    setBusy('send');
    const done: string[] = [];
    let stopped: { name: string; title: string; fix: string } | null = null;
    const partly: string[] = [];
    for (const id of ids) {
      const p = byId.get(id)!, card = cards.current.get(id)!;
      setStates(s => ({ ...s, [id]: { s: 'sending' } }));
      try {
        const form = new FormData();
        form.set('file', new File([await card.outgoing()], `${slugOf(p)}.jpg`, { type: 'image/jpeg' }));
        form.set('caption', card.caption());
        form.set('sitePiece', p.id);
        form.set('targets', targets.join(','));
        const res = await fetch('/api/website/post', { method: 'POST', headers: await authHeaders(), body: form });
        const d = await res.json().catch(() => ({}));
        const results = (d.results ?? []) as { key: string; ok: boolean; error?: string }[];
        if (!res.ok && !results.some(r => r.ok)) throw Object.assign(new Error(d.error || `${res.status}`), { status: res.status });
        setPosted(prev => ({ ...prev, [id]: new Date().toISOString() }));
        // Some places took it and some didn't: it has gone, so it leaves the tray (sending it again would post twice).
        const missed = results.filter(r => !r.ok);
        if (missed.length) partly.push(`${p.name} didn’t go to ${listOf(missed.map(r => labelOf(r.key)))}: ${missed[0].error}`);
        done.push(id);
        setStates(s => { const { [id]: _, ...rest } = s; return rest; });
      } catch (e) {
        const dg = diagnose('whatsapp', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
        setStates(s => ({ ...s, [id]: { s: 'failed', error: `${dg.title} — ${dg.fix}` } }));
        stopped = { name: p.name, title: dg.title, fix: dg.fix };
        break;
      }
    }
    setBusy(null);
    const left = picked.filter(id => !done.includes(id));
    setPicked(left);
    setActive(cur => (cur && left.includes(cur) ? cur : left[0] ?? null));
    if (done.length) loadSent();
    const where = listOf(targets.map(labelOf));
    if (stopped) {
      const s = stopped as { name: string; title: string; fix: string };
      toast({ title: done.length ? `${done.length} sent, then ${s.name} didn’t go` : `${s.name} didn’t go`, description: `${s.title} — ${s.fix}${left.length > 1 ? ' The rest are still in the tray.' : ''}`, variant: 'destructive' });
    } else if (partly.length) {
      toast({ title: `Sent ${done.length} ${noun(done.length)}, not everywhere`, description: partly.join(' · '), variant: 'destructive' });
    } else if (done.length) {
      toast({ title: `Sent ${done.length} ${noun(done.length)} to ${where}`, description: done.length === 1 ? `${byId.get(done[0])?.name}, with its link.` : 'Each with its own caption and link.' });
    }
  };

  /** Into the queue, to send later or spread over the day: each piece exactly as its card makes it now. */
  const queueThem = async () => {
    const ids = picked.filter(id => cards.current.has(id) && byId.has(id));
    setBusy('queue');
    const done: string[] = [];
    for (const id of ids) {
      const p = byId.get(id)!, card = cards.current.get(id)!;
      setStates(s => ({ ...s, [id]: { s: 'sending' } }));
      try {
        const blob = await card.outgoing();
        const thumb = await loadImage(blob).then(img => thumbOf(img)).catch(() => null);
        const ok = await queue.add({
          headline: p.name, caption: card.caption(), fileBase: slugOf(p), sitePiece: p.id,
          targets: { website: null, instagram: false, whatsapp: targets }, site: [], wa: [blob], story: null, thumb,
        });
        setStates(s => { const { [id]: _, ...rest } = s; return rest; });
        if (!ok) break;
        done.push(id);
      } catch (e) {
        setStates(s => ({ ...s, [id]: { s: 'failed', error: e instanceof Error ? e.message : String(e) } }));
        break;
      }
    }
    setBusy(null);
    const left = picked.filter(id => !done.includes(id));
    setPicked(left);
    setActive(cur => (cur && left.includes(cur) ? cur : left[0] ?? null));
    if (done.length) {
      toast({ title: `${done.length} ${noun(done.length)} in the queue`, description: 'Send them now, give each a time, or spread them over the day — they go by themselves.' });
      setTimeout(() => queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  };

  // On a phone, while the Send box is out of sight, a bar at the bottom says what is picked and takes you to it.
  useEffect(() => {
    const el = sendRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setSendInView(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [n > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const siteName = site ? host(site) : host(STORE_LINKS.website || '') || 'the website';
  const waBlockers = blockers(true);
  const hasQueue = queue.items.some(e => e.status !== 'sent') || queue.items.some(e => e.status === 'sent' && new Date(e.sentAt || e.createdAt).toDateString() === new Date().toDateString());

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-5 pb-24 lg:pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><Send className="mr-3 h-7 w-7" /> Posts</h1>
          <p className="text-sm text-muted-foreground mt-1">What went out today, what’s waiting, and anything new — the website’s pieces, new photos{STORE_INVESTMENTS ? ', the gold post' : ''}.</p>
        </div>
        {STORE_POST_PIECE && (
          <div className="flex gap-2">
            {drafts.count > 0 && (
              <Button variant="outline" size="sm" onClick={() => setDraftsOpen(true)}>
                <FileClock className="h-4 w-4 mr-1.5" />Drafts<span className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">{drafts.count}</span>
              </Button>
            )}
            <Button size="sm" asChild><Link href="/website/post?new=1"><Camera className="h-4 w-4 mr-1.5" /> New piece</Link></Button>
          </div>
        )}
      </div>

      {/* Post a Piece's piece in progress, a tap away. */}
      {drafts.current && (
        <Link href="/website/post" className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm hover:bg-primary/10">
          <History className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">Still making <b className="font-medium">{drafts.current.title || 'a piece'}</b> in Post a piece</span>
          <span className="shrink-0 text-primary font-medium">Continue</span>
        </Link>
      )}

      <HealthPanel health={health} />

      <div className={cn('grid min-w-0 gap-5 [&>*]:min-w-0', hasQueue && 'lg:grid-cols-2')}>
        <TodayCard sent={sent} investments={inv} now={now} thumbOf={id => byId.get(id)?.thumb} placeName={placeName} />
        {hasQueue && (
          <div ref={queueRef} className="scroll-mt-20 [&>div]:rounded-2xl [&>div]:bg-card [&>div]:shadow-sm">
            <QueuePanel api={queue} destinationName={k => (k === 'channel' ? audience.channel?.name ?? 'Channel' : audience.groups.find(g => g.key === k)?.label ?? k)}
              blockers={entries => blockers(entries.some(e => e.whatsapp.length), entries.some(e => e.instagram), entries.some(e => !!e.website))} />
          </div>
        )}
      </div>

      {STORE_SITE_POSTS && (<>
        <div className="flex items-end justify-between gap-3 pt-1">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-tight">From {siteName}</h2>
            <p className="text-xs text-muted-foreground">Tap one piece or several — each gets its own caption — then send them together, or queue them for later.</p>
          </div>
        </div>
        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{error} <button type="button" className="text-primary ml-2" onClick={load}>Try again</button></div>}
        {pieces && !audience.community && <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">No WhatsApp community is set up for this shop yet (WHATSAPP_COMMUNITY_CHAT_ID), so nothing can be sent from here.</p>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* The tray — first on a phone, beside the grid on a computer (its own scroll, so Send never leaves the screen). */}
          <aside ref={trayRef} className="order-1 lg:order-2 min-w-0 self-start space-y-3 scroll-mt-16 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto lg:pr-1">
            {n > 0 ? (<>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
                  {picked.map((id, i) => {
                    const p = byId.get(id), st = states[id];
                    return (
                      <button key={id} type="button" onClick={() => setActive(id)} title={p?.name}
                        className={cn('relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2', active === id ? 'border-primary' : 'border-transparent opacity-80 hover:opacity-100')}>
                        {p && <img src={p.thumb} alt="" className="h-full w-full object-cover" />}
                        <span className="absolute left-0.5 top-0.5 rounded-full bg-black/60 px-1 text-[10px] leading-4 text-white">{i + 1}</span>
                        {st?.s === 'sending' && <span className="absolute inset-0 flex items-center justify-center bg-background/60"><Loader2 className="h-5 w-5 animate-spin text-primary" /></span>}
                        {st?.s === 'failed' && <span className="absolute inset-x-0 bottom-0 bg-destructive py-0.5 text-center text-[9px] font-medium text-destructive-foreground">didn’t go</span>}
                      </button>
                    );
                  })}
                </div>
                {n > 1 && <button type="button" disabled={!!busy} onClick={() => { setPicked([]); setActive(null); setStates({}); }} className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">Clear</button>}
              </div>

              {/* Where they go and the one press that sends them — above the cards, so a batch is sent without scrolling. */}
              <div ref={sendRef} className="rounded-xl border bg-card p-3 space-y-2.5 shadow-sm">
                {audience.groups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {audience.groups.map(g => {
                      const on = targets.includes(g.key);
                      return (
                        <button key={g.key} type="button" disabled={!!busy} onClick={() => chooseTarget(g.key)}
                          className={cn('rounded-full border px-3 py-1.5 text-xs inline-flex items-center', on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>
                          {on ? <Check className="h-3 w-3 mr-1" /> : <MessageCircle className="h-3 w-3 mr-1" />}{g.label}{g.size ? <span className="opacity-70">&nbsp;· {g.size.toLocaleString()}</span> : null}
                        </button>
                      );
                    })}
                    {audience.channel && (
                      <button type="button" disabled={!!busy} onClick={() => chooseTarget('channel')}
                        className={cn('rounded-full border px-3 py-1.5 text-xs inline-flex items-center', targets.includes('channel') ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>
                        {targets.includes('channel') ? <Check className="h-3 w-3 mr-1" /> : <Radio className="h-3 w-3 mr-1" />}Channel{audience.channel.followers ? <span className="opacity-70">&nbsp;· {audience.channel.followers.toLocaleString()}</span> : null}
                      </button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Button className="h-11" disabled={!canSend} onClick={() => setConfirm(true)}>
                    {busy === 'send' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
                    {busy === 'send' ? 'Sending…' : n > 1 ? `Send all ${n}` : 'Send it'}
                  </Button>
                  <Button variant="secondary" className="h-11" disabled={!canSend} onClick={queueThem} title="Send later, or spread over the day">
                    {busy === 'queue' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Clock className="h-4 w-4 mr-1.5" />} Later
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {!targets.length ? 'Choose where they go.' : <>To {listOf(targets.map(labelOf))}{n > 1 ? ', one after another' : ''}. <b className="font-medium">Later</b> puts {n > 1 ? 'them' : 'it'} in the queue to send at a time, or spread over the day.</>}
                </p>
                {waBlockers.length > 0 && <p className="text-[11px] text-destructive">{waBlockers.map(c => `${c.label}: ${c.fix ?? c.detail}`).join(' · ')}</p>}
              </div>

              {picked.map(id => {
                const p = byId.get(id);
                return p ? (
                  <PieceCard key={id} piece={p} shown={id === active} siteName={siteName} posted={posted[id]} photo={photo} token={authHeaders} ig={ig}
                    locked={!!busy} failed={states[id]?.s === 'failed' ? states[id]?.error : undefined} onRegister={register} onRemove={() => take(id)} onAnother={() => another(id)} />
                ) : null;
              })}
            </>) : (
              <div className="rounded-xl border-2 border-dashed p-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Tap pieces below — one, or a few to send together.</p>
                <Button className="h-11 w-full" disabled={!pieces?.length} onClick={shuffle}><Shuffle className="h-4 w-4 mr-2" /> Shuffle a piece</Button>
              </div>
            )}
          </aside>

          <section className="order-2 lg:order-1 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[12rem]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search — ruby, kara, jhumka…" className="h-10 pl-9" />
              </div>
              <Button variant="outline" className="h-10" disabled={!pieces?.length || !!busy} onClick={shuffle}><Shuffle className="h-4 w-4 mr-1.5" /> Shuffle</Button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {[...(hasNew ? [NEW] : []), '', ...collections].map(c => (
                <button key={c || 'all'} type="button" onClick={() => setCollection(c)}
                  className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap inline-flex items-center gap-1', showing === c ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>
                  {c === NEW ? <><Sparkles className="h-3 w-3" /> New arrivals</> : c || 'Everything'}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={freshOnly} onCheckedChange={setFreshOnly} /> Hide pieces posted in the last {FRESH_DAYS} days</label>

            {!pieces && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Reading the website…</div>}
            {pieces && <p className="text-xs text-muted-foreground">{filtered.length.toLocaleString()} of {pieces.length.toLocaleString()} pieces</p>}
            <ul className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {filtered.slice(0, shown).map(p => {
                const at = picked.indexOf(p.id);
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => toggle(p)} aria-pressed={at >= 0} className={cn('group block w-full text-left rounded-lg border overflow-hidden', at >= 0 ? 'ring-2 ring-primary border-primary' : 'hover:border-primary/60')}>
                      <span className="relative block aspect-square bg-muted">
                        <img src={p.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                        {at >= 0
                          ? <span className="absolute right-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">{picked.length > 1 ? at + 1 : <Check className="h-3.5 w-3.5" />}</span>
                          : <span className="absolute right-1.5 top-1.5 h-6 w-6 rounded-full border-2 border-white/80 bg-black/20 opacity-70 group-hover:opacity-100" />}
                        {p.newArrival && showing !== NEW && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">New</span>}
                      </span>
                      <span className="block px-2 py-1.5">
                        <span className="block text-xs font-medium leading-tight line-clamp-2">{p.name}</span>
                        <span className={cn('block text-[10px] truncate', posted[p.id] && daysAgo(posted[p.id]) < 1 ? 'text-amber-600' : 'text-muted-foreground')}>{posted[p.id] ? agoLabel(posted[p.id]) : p.collection}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {filtered.length > shown && <Button variant="outline" className="w-full" onClick={() => setShown(k => k + PAGE)}>Show more ({(filtered.length - shown).toLocaleString()} left)</Button>}
          </section>
        </div>
      </>)}

      {/* On a phone: what is picked, while the Send box is out of sight. */}
      {n > 0 && !sendInView && (
        <div className="glass-bar lg:hidden fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2.5 pr-20 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => sendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="flex w-full items-center gap-2.5 text-left">
            <span className="flex shrink-0 -space-x-3">{picked.slice(0, 2).map(id => <img key={id} src={byId.get(id)?.thumb} alt="" className="h-8 w-8 rounded-md border-2 border-background object-cover" />)}</span>
            <span className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium">{n} picked</span>
            <span className="shrink-0 whitespace-nowrap rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">{busy === 'send' ? 'Sending…' : 'Send…'}</span>
          </button>
        </div>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {n > 1 ? `these ${n} pieces` : 'it'} to {listOf(targets.map(labelOf))}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2.5 text-sm">
                <ul className="space-y-1.5 max-h-[40vh] overflow-y-auto">
                  {picked.map(id => {
                    const p = byId.get(id), card = cards.current.get(id);
                    return p ? (
                      <li key={id} className="flex items-center gap-2.5">
                        <img src={card?.preview() ?? p.thumb} alt="" className="h-11 w-11 rounded-md object-cover shrink-0" />
                        <div className="min-w-0"><p className="font-medium text-foreground truncate">{p.name}</p><p className="text-xs truncate">{card?.going()}{posted[id] ? ` · ${agoLabel(posted[id])}` : ''}</p></div>
                      </li>
                    ) : null;
                  })}
                </ul>
                <ul className="text-xs">{targets.map(k => <li key={k}>{k === 'channel' ? `${audience.channel?.name ?? 'Channel'} (channel)` : labelOf(k)}{reachOf(k) ? ` — ${reachOf(k)!.toLocaleString()} ${k === 'channel' ? 'followers' : 'members'}` : ''}</li>)}</ul>
                <p className="text-xs">Each with its own caption and link{n > 1 ? ', one after another — it stops at the first that fails' : ''}. A post can’t be unsent from here.</p>
                {waBlockers.length > 0 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-1 text-foreground">
                    <p className="font-semibold text-destructive text-xs">This will probably fail:</p>
                    {waBlockers.map(c => <p key={c.id} className="text-xs"><span className="font-medium">{c.label}</span> — {c.fix ?? c.detail}</p>)}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(false); send(); }}>{waBlockers.length ? 'Send anyway' : 'Send'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {STORE_POST_PIECE && (
        <PostDraftsDialog open={draftsOpen} onOpenChange={setDraftsOpen} currentId={null}
          onContinue={id => router.push(`/website/post?draft=${encodeURIComponent(id)}`)} onNew={() => router.push('/website/post?new=1')}
          onChanged={refreshDrafts} onDeletedCurrent={() => { setDraftsOpen(false); refreshDrafts(); }} />
      )}
    </div>
  );
}
