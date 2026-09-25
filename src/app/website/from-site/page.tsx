'use client';

/**
 * Posts → From the website: any piece already on this house's website — picked,
 * searched, or shuffled — to the WhatsApp community with its link, in one press.
 *
 * The site's photographs already carry the house's marks (taheri.shop: the
 * weight top-left and the wordmark top-right, as the community's own posts do;
 * the Mina catalogue: the MINA wordmark), so the photo goes as it is — or with
 * the weight stamped on in the overlay tool's geometry (Futura LT Light,
 * top-left; stampPhoto), on by default only where the photo doesn't show it
 * already. The caption is the house's shape (sitePieceCaption: its name,
 * weight, facts, the link, and the house's closing lines), editable, or with
 * its line and facts written by AI in the house's voice. The send is the same route Post a Piece uses: the community,
 * and the channel too when the line is on WAHA; each send is logged with the
 * piece, so Shuffle skips what went out lately.
 *
 * It opens on the website's new arrivals (the owner, 2026-09-25: "by default
 * show new arrivals" — src/lib/website/new-arrivals.ts), newest first; Shuffle
 * picks from whatever is showing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Shuffle, Send, Loader2, Search, ExternalLink, Sparkles, RotateCcw, Check, Globe, MessageCircle, Radio, Megaphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { diagnose } from '@/lib/social/diagnose';
import { sitePieceCaption } from '@/lib/social/caption';
import { loadImage, stampPhoto } from '@/lib/social/story';
import { STORE_SITE_POSTS, STORE_POST_METAL, STORE_POST_FOOTER, STORE_POST_TAGLINE, STORE_WHATSAPP_NUMBERS, STORE_LINKS, STORE_META_ADS } from '@/lib/store-config';
import Link from 'next/link';

interface Piece { id: string; name: string; url: string; image: string; thumb: string; collection: string; weightGrams: number | null; weightOnPhoto: boolean; facts: string[]; about: string; added: number | null; newArrival: boolean }
/** The "collection" chip for the new arrivals — what the page opens on. */
const NEW = '__new';
interface Group { key: string; label: string; name: string; size: number | null; reachable: boolean }
interface Audience { community: { name: string; size: number | null; reachable: boolean } | null; channel: { name: string; followers: number | null } | null; groups: Group[] }
/** "Announcements, Diamonds and the channel". */
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
const agoLabel = (iso: string) => { const d = daysAgo(iso); return d <= 0 ? 'posted today' : d === 1 ? 'posted yesterday' : `posted ${d} days ago`; };
/** Pieces posted within this many days are skipped by Shuffle (unless it runs out). */
const FRESH_DAYS = 30;
/** A weight as typed ("3.84", "12") — a positive number, or nothing. */
const validWeight = (w: string) => /^\d+(\.\d+)?$/.test(w.trim()) && Number(w) > 0;
const PAGE = 60;

export default function FromSiteRoute() {
  // A wrapper, so the page's own hooks never sit behind an early return.
  if (!STORE_SITE_POSTS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn't post from its website.</p>;
  return <FromSitePage />;
}

function FromSitePage() {
  const { toast } = useToast();
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [site, setSite] = useState('');
  const [posted, setPosted] = useState<Record<string, string>>({});
  const [audience, setAudience] = useState<Audience>({ community: null, channel: null, groups: [] });
  // The community's groups this post goes to (Announcements by default); the channel is its own button.
  const [chosenGroups, setChosenGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [collection, setCollection] = useState(NEW);
  const [freshOnly, setFreshOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [pick, setPick] = useState<Piece | null>(null);
  const [caption, setCaption] = useState('');
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState<'send' | 'ai' | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // The weight on the photo, and the AI's words for the caption.
  const [overlay, setOverlay] = useState(false);
  const [weight, setWeight] = useState('');
  const [ink, setInk] = useState<'auto' | 'white' | 'dark'>('auto');
  const [preview, setPreview] = useState<string | null>(null);
  const [aiWords, setAiWords] = useState<{ line: string; facts: string } | null>(null);
  const photos = useRef(new Map<string, Blob>());
  const stamped = useRef<{ key: string; blob: Blob } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const headers = await authHeaders();
      const [pr, ar] = await Promise.all([
        fetch('/api/website/site-pieces', { headers, cache: 'no-store' }),
        fetch('/api/website/post', { headers, cache: 'no-store' }),
      ]);
      const d = await pr.json().catch(() => ({}));
      if (!pr.ok) throw new Error(d.error || `${pr.status}`);
      setPieces(d.pieces); setSite(d.site); setPosted(d.posted || {});
      if (ar.ok) {
        const a = await ar.json();
        const groups: Group[] = a.groups ?? [];
        setAudience({ community: a.community ?? null, channel: a.channel ?? null, groups });
        setChosenGroups(prev => (prev.length ? prev : groups.slice(0, 1).map(g => g.key)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const collections = useMemo(() => [...new Set((pieces ?? []).map(p => p.collection).filter(Boolean))].sort(), [pieces]);
  // A site that gives no dates has no new arrivals: the page shows everything instead.
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

  /** The house's caption for a piece: its weight as it will show, and the AI's line and facts when there are some. */
  const houseCaption = (p: Piece, w = weight, words = aiWords) => sitePieceCaption(
    { name: p.name, url: p.url, weightGrams: validWeight(w) ? Number(w) : null, facts: words ? [words.facts] : p.facts, about: words ? words.line : p.about },
    { metal: STORE_POST_METAL, tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER, whatsappNumbers: STORE_WHATSAPP_NUMBERS },
  );
  const choose = (p: Piece) => {
    const w = p.weightGrams ? String(p.weightGrams) : '';
    setPick(p); setWeight(w); setAiWords(null); setEdited(false);
    // Stamp the weight only where the photo doesn't already show it.
    setOverlay(!!p.weightGrams && !p.weightOnPhoto);
    setCaption(houseCaption(p, w, null));
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // Typing a weight keeps an untouched caption in step with it.
  useEffect(() => { if (pick && !edited) setCaption(houseCaption(pick)); }, [weight, aiWords]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A piece at random from what's showing — the ones not posted lately, unless there are none. */
  const shuffle = () => {
    const pool = filtered.filter(p => !recent(p) && p.id !== pick?.id);
    const from = pool.length ? pool : filtered.filter(p => p.id !== pick?.id);
    if (!from.length) { toast({ title: 'Nothing to shuffle', description: 'Clear the search or pick another collection.' }); return; }
    choose(from[Math.floor(Math.random() * from.length)]);
  };

  /** The website's photograph, fetched once through this server (the site doesn't share it with other pages). */
  const photo = async (p: Piece): Promise<Blob> => {
    const have = photos.current.get(p.id);
    if (have) return have;
    const res = await fetch(`/api/website/site-pieces/image?id=${encodeURIComponent(p.id)}`, { headers: await authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The photograph didn’t come (${res.status}).`);
    const b = await res.blob();
    photos.current.set(p.id, b);
    return b;
  };
  /** The photo that goes out: stamped with the weight when the overlay is on. */
  const outgoing = async (p: Piece): Promise<Blob> => {
    if (!overlay || !validWeight(weight)) return photo(p);
    const key = `${p.id}|${weight}|${ink}`;
    if (stamped.current?.key === key) return stamped.current.blob;
    const blob = await stampPhoto(await loadImage(await photo(p)), { text: `${weight.trim()}g`, colour: ink, maxEdge: 2048 });
    stamped.current = { key, blob };
    return blob;
  };
  // The preview shows exactly what will go: the stamped photo while the overlay is on.
  useEffect(() => {
    if (!pick || !overlay || !validWeight(weight)) { setPreview(null); return; }
    let alive = true, url = '';
    const t = setTimeout(async () => {
      try { const b = await outgoing(pick); if (alive) { url = URL.createObjectURL(b); setPreview(url); } }
      catch (e) { if (alive) toast({ title: 'Could not put the weight on', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
    }, 250);
    return () => { alive = false; clearTimeout(t); if (url) URL.revokeObjectURL(url); };
  }, [pick, overlay, weight, ink]); // eslint-disable-line react-hooks/exhaustive-deps
  const writeWithAi = async () => {
    if (!pick) return;
    setBusy('ai');
    try {
      const res = await fetch('/api/website/site-pieces/caption', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ id: pick.id, weight: validWeight(weight) ? `${weight.trim()}g` : '' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(d.error || `${res.status}`), { status: res.status });
      const words = { line: d.line as string, facts: d.facts as string };
      setAiWords(words); setEdited(false); setCaption(houseCaption(pick, weight, words));
      toast({ title: 'Caption written', description: 'Read it over before sending — the link and the closing lines are the house’s own.' });
    } catch (e) {
      const dg = diagnose('caption', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
      toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };
  /** What a destination key is called on the page. */
  const labelOf = (k: string) => (k === 'channel' ? 'the channel' : audience.groups.find(g => g.key === k)?.label ?? k);
  const reachOf = (k: string) => (k === 'channel' ? audience.channel?.followers ?? null : audience.groups.find(g => g.key === k)?.size ?? null);
  /** Send to exactly these destinations (group keys and/or "channel"), one after another. */
  const send = async (targets: string[]) => {
    if (!pick || !targets.length) return;
    setBusy('send');
    try {
      const form = new FormData();
      const slug = pick.url.split('/').filter(Boolean).pop() || 'piece';
      form.set('file', new File([await outgoing(pick)], `${slug}.jpg`, { type: 'image/jpeg' }));
      form.set('caption', caption);
      form.set('sitePiece', pick.id);
      form.set('targets', targets.join(','));
      const res = await fetch('/api/website/post', { method: 'POST', headers: await authHeaders(), body: form });
      const d = await res.json().catch(() => ({}));
      const results = (d.results ?? []) as { key: string; ok: boolean; error?: string }[];
      if (!res.ok && !results.some(r => r.ok)) throw Object.assign(new Error(d.error || `${res.status}`), { status: res.status });
      setPosted(prev => ({ ...prev, [pick.id]: new Date().toISOString() }));
      const sent = results.filter(r => r.ok).map(r => labelOf(r.key)), missed = results.filter(r => !r.ok);
      toast({
        title: `Sent to ${listOf(sent)}`,
        description: missed.length ? `Didn’t go to ${listOf(missed.map(r => labelOf(r.key)))}: ${missed[0].error}` : `${pick.name}, with its link.`,
        variant: missed.length ? 'destructive' : undefined,
      });
    } catch (e) {
      const dg = diagnose('whatsapp', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
      toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const siteName = site ? host(site) : host(STORE_LINKS.website || '') || 'the website';
  const community = audience.community;

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-5">
      <div ref={topRef} className="scroll-mt-20">
        <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><Globe className="mr-3 h-7 w-7" /> Post from {siteName}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick any piece from the website — or shuffle — and send it with its link to {community ? <b>{community.name}</b> : 'the community'}{audience.groups.length > 1 ? '’s groups' : ''}{audience.channel ? <>, <b>{audience.channel.name}</b>’s channel, or both</> : null}.
        </p>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{error} <button type="button" className="text-primary ml-2" onClick={load}>Try again</button></div>}
      {!community && pieces && <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">No WhatsApp community is set up for this shop yet (WHATSAPP_COMMUNITY_CHAT_ID), so nothing can be sent from here.</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* The piece to send — first on a phone, beside the grid on a computer. */}
        <aside className="order-1 lg:order-2 min-w-0 lg:sticky lg:top-4 self-start space-y-3">
          {pick ? (
            <div className="rounded-xl border overflow-hidden">
              <a href={pick.url} target="_blank" rel="noopener" className="block bg-muted"><img src={preview ?? pick.image} alt={pick.name} className="w-full aspect-square object-contain" /></a>
              <div className="p-3 space-y-3">
                {/* The weight on the photo, as the catalogue's own overlay draws it. */}
                <div className="rounded-lg border px-3 py-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={overlay} onCheckedChange={setOverlay} /> Weight on the photo</label>
                    <div className="ml-auto flex items-center gap-1">
                      <Input value={weight} onChange={e => setWeight(e.target.value.replace(/[^\d.]/g, ''))} onFocus={e => e.currentTarget.select()} inputMode="decimal" placeholder="0.00" className="h-9 w-20 text-right tabular-nums" aria-label="Weight in grams" />
                      <span className="text-sm text-muted-foreground">g</span>
                    </div>
                  </div>
                  {overlay && (
                    <div className="inline-flex rounded-full border p-0.5 text-xs">
                      {(['auto', 'white', 'dark'] as const).map(c => (
                        <button key={c} type="button" onClick={() => setInk(c)} className={cn('rounded-full px-3 py-1', ink === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{c === 'auto' ? 'Auto colour' : c === 'white' ? 'White' : 'Dark'}</button>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {pick.weightOnPhoto
                      ? overlay ? 'This photo already shows its weight — with this on it shows twice.' : 'This photo already shows its weight.'
                      : overlay && !validWeight(weight) ? 'Type the weight to put it on.' : 'Top-left, in the catalogue’s own lettering. It also goes in the caption.'}
                  </p>
                </div>
                <div>
                  <p className="font-semibold leading-tight">{pick.name}</p>
                  <p className="text-xs text-muted-foreground">{[pick.collection, pick.weightGrams ? `${pick.weightGrams}g` : ''].filter(Boolean).join(' · ')}</p>
                  <a href={pick.url} target="_blank" rel="noopener" className="text-xs text-primary inline-flex items-center gap-1 break-all">{pick.url.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3 shrink-0" /></a>
                  {posted[pick.id] && <p className="text-xs text-amber-600 mt-1">Already went to the community — {agoLabel(posted[pick.id])}.</p>}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">Caption</span>
                    <div className="flex items-center gap-2">
                      {(edited || aiWords) && <button type="button" className="text-xs text-muted-foreground inline-flex items-center gap-1" onClick={() => { setAiWords(null); setCaption(houseCaption(pick, weight, null)); setEdited(false); }}><RotateCcw className="h-3 w-3" /> House caption</button>}
                      <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={!!busy} onClick={writeWithAi}>{busy === 'ai' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />} Write with AI</Button>
                    </div>
                  </div>
                  <Textarea value={caption} onChange={e => { setCaption(e.target.value); setEdited(true); }} rows={10} className="font-mono text-xs leading-relaxed" />
                </div>
                {/* Where it goes: any of the community's groups, the channel, or both. */}
                {audience.groups.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Groups</p>
                    <div className="flex flex-wrap gap-1.5">
                      {audience.groups.map(g => {
                        const on = chosenGroups.includes(g.key);
                        return (
                          <button key={g.key} type="button" onClick={() => setChosenGroups(c => on ? c.filter(k => k !== g.key) : [...c, g.key])}
                            className={cn('rounded-full border px-3 py-1.5 text-xs', on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>
                            {on && <Check className="inline h-3 w-3 mr-1 -mt-0.5" />}{g.label}{g.size ? <span className="opacity-70"> · {g.size.toLocaleString()}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className={cn('grid gap-2', audience.channel ? 'grid-cols-2' : 'grid-cols-1')}>
                  <Button className="h-11" disabled={!!busy || !chosenGroups.length || !caption.trim()} onClick={() => setConfirm(chosenGroups)}>
                    {busy === 'send' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />} {chosenGroups.length > 1 ? `${chosenGroups.length} groups` : chosenGroups.length ? labelOf(chosenGroups[0]) : 'Choose a group'}
                  </Button>
                  {audience.channel && (
                    <Button variant="secondary" className="h-11" disabled={!!busy || !caption.trim()} onClick={() => setConfirm(['channel'])}><Radio className="h-4 w-4 mr-1.5" /> Channel</Button>
                  )}
                  {audience.channel && (
                    <Button variant="default" className="col-span-2 h-11" disabled={!!busy || !chosenGroups.length || !caption.trim()} onClick={() => setConfirm([...chosenGroups, 'channel'])}>
                      <Send className="h-4 w-4 mr-1.5" /> Both — {chosenGroups.length > 1 ? `${chosenGroups.length} groups` : chosenGroups.length ? labelOf(chosenGroups[0]) : 'groups'} and the channel
                    </Button>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">{overlay && validWeight(weight) ? `The photo with ${weight.trim()}g on it.` : 'The photo as it is on the website.'}</p>
                  <div className="flex shrink-0">
                    {STORE_META_ADS && <Button asChild variant="ghost" size="sm" className="h-8"><Link href={`/ads/new?piece=${encodeURIComponent(pick.id)}`}><Megaphone className="h-4 w-4 mr-1.5" /> Promote</Link></Button>}
                    <Button variant="ghost" size="sm" className="h-8" disabled={!!busy} onClick={shuffle}><Shuffle className="h-4 w-4 mr-1.5" /> Another</Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-dashed p-6 text-center space-y-3">
              <p className="text-sm text-muted-foreground">Tap a piece below, or let it choose one.</p>
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
            <Button variant="outline" className="h-10" disabled={!pieces?.length} onClick={shuffle}><Shuffle className="h-4 w-4 mr-1.5" /> Shuffle</Button>
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
            {filtered.slice(0, shown).map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => choose(p)} className={cn('group block w-full text-left rounded-lg border overflow-hidden', pick?.id === p.id ? 'ring-2 ring-primary border-primary' : 'hover:border-primary/60')}>
                  <span className="relative block aspect-square bg-muted">
                    <img src={p.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {pick?.id === p.id && <span className="absolute right-1.5 top-1.5 rounded-full bg-primary p-1 text-primary-foreground"><Check className="h-3 w-3" /></span>}
                    {p.newArrival && showing !== NEW && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">New</span>}
                  </span>
                  <span className="block px-2 py-1.5">
                    <span className="block text-xs font-medium leading-tight line-clamp-2">{p.name}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">{posted[p.id] ? agoLabel(posted[p.id]) : p.collection}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length > shown && <Button variant="outline" className="w-full" onClick={() => setShown(n => n + PAGE)}>Show more ({(filtered.length - shown).toLocaleString()} left)</Button>}
        </section>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send it to {confirm ? listOf(confirm.map(labelOf)) : ''}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {pick && <div className="flex gap-3"><img src={preview ?? pick.thumb} alt="" className="h-16 w-16 rounded-md object-cover" /><div><p className="font-medium text-foreground">{pick.name}</p>
                  <ul className="text-xs mt-0.5">{(confirm ?? []).map(k => <li key={k}>{k === 'channel' ? (audience.channel?.name ?? 'Channel') + ' (channel)' : labelOf(k)}{reachOf(k) ? ` — ${reachOf(k)!.toLocaleString()} ${k === 'channel' ? 'followers' : 'members'}` : ''}</li>)}</ul>
                </div></div>}
                <p className="text-xs">{overlay && validWeight(weight) ? `The photo with ${weight.trim()}g on it` : 'The photo as it is on the website'}, with the caption and its link. It can’t be unsent from here.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const t = confirm ?? []; setConfirm(null); send(t); }}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
