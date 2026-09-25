'use client';

/**
 * Posts → From the website: any piece already on this house's website — picked,
 * searched, or shuffled — to the WhatsApp community with its link, in one press.
 *
 * The site's photographs already carry the house's marks (taheri.shop: the
 * weight top-left and the wordmark top-right, as the community's own posts do;
 * the Mina catalogue: the MINA wordmark), so the photo goes as it is. The
 * caption is the house's shape (sitePieceCaption: its name, weight, facts, the
 * link, and the house's closing lines), editable, or written by AI where the
 * house has it. The send is the same route Post a Piece uses: the community,
 * and the channel too when the line is on WAHA; each send is logged with the
 * piece, so Shuffle skips what went out lately.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Shuffle, Send, Loader2, Search, ExternalLink, Sparkles, RotateCcw, Check, Globe, MessageCircle, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { diagnose } from '@/lib/social/diagnose';
import { sitePieceCaption } from '@/lib/social/caption';
import { STORE_SITE_POSTS, STORE_POST_PIECE, STORE_POST_METAL, STORE_POST_FOOTER, STORE_POST_TAGLINE, STORE_WHATSAPP_NUMBERS, STORE_LINKS } from '@/lib/store-config';

interface Piece { id: string; name: string; url: string; image: string; thumb: string; collection: string; weightGrams: number | null; facts: string[]; about: string }
interface Audience { community: { name: string; size: number | null; reachable: boolean } | null; channel: { name: string; followers: number | null } | null }

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
const agoLabel = (iso: string) => { const d = daysAgo(iso); return d <= 0 ? 'posted today' : d === 1 ? 'posted yesterday' : `posted ${d} days ago`; };
/** Pieces posted within this many days are skipped by Shuffle (unless it runs out). */
const FRESH_DAYS = 30;
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
  const [audience, setAudience] = useState<Audience>({ community: null, channel: null });
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [collection, setCollection] = useState('');
  const [freshOnly, setFreshOnly] = useState(true);
  const [shown, setShown] = useState(PAGE);
  const [pick, setPick] = useState<Piece | null>(null);
  const [caption, setCaption] = useState('');
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState<'send' | 'ai' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

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
      if (ar.ok) { const a = await ar.json(); setAudience({ community: a.community ?? null, channel: a.channel ?? null }); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const collections = useMemo(() => [...new Set((pieces ?? []).map(p => p.collection).filter(Boolean))].sort(), [pieces]);
  const recent = (p: Piece) => !!posted[p.id] && daysAgo(posted[p.id]) < FRESH_DAYS;
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (pieces ?? []).filter(p => (!collection || p.collection === collection)
      && (!freshOnly || !recent(p))
      && words.every(w => `${p.name} ${p.collection} ${p.facts.join(' ')}`.toLowerCase().includes(w)));
  }, [pieces, q, collection, freshOnly, posted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setShown(PAGE); }, [q, collection, freshOnly]);

  const houseCaption = (p: Piece) => sitePieceCaption(
    { name: p.name, url: p.url, weightGrams: p.weightGrams, facts: p.facts, about: p.about },
    { metal: STORE_POST_METAL, tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER, whatsappNumbers: STORE_WHATSAPP_NUMBERS },
  );
  const choose = (p: Piece) => {
    setPick(p); setCaption(houseCaption(p)); setEdited(false);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  /** A piece at random from what's showing — the ones not posted lately, unless there are none. */
  const shuffle = () => {
    const pool = filtered.filter(p => !recent(p) && p.id !== pick?.id);
    const from = pool.length ? pool : filtered.filter(p => p.id !== pick?.id);
    if (!from.length) { toast({ title: 'Nothing to shuffle', description: 'Clear the search or pick another collection.' }); return; }
    choose(from[Math.floor(Math.random() * from.length)]);
  };

  const photo = async (p: Piece): Promise<Blob> => {
    const res = await fetch(`/api/website/site-pieces/image?id=${encodeURIComponent(p.id)}`, { headers: await authHeaders() });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The photograph didn’t come (${res.status}).`);
    return res.blob();
  };
  const writeWithAi = async () => {
    if (!pick) return;
    setBusy('ai');
    try {
      const form = new FormData();
      form.set('op', 'caption');
      form.set('params', JSON.stringify({
        headline: pick.name, weight: pick.weightGrams ? `${pick.weightGrams}g` : '', metal: STORE_POST_METAL, stones: pick.facts.join(', '),
        collection: pick.collection, numbers: STORE_WHATSAPP_NUMBERS, link: pick.url, brief: '',
      }));
      form.append('image', await photo(pick), 'piece.jpg');
      const res = await fetch('/api/website/post/ai', { method: 'POST', headers: await authHeaders(), body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(d.error || `${res.status}`), { status: res.status });
      setCaption(d.caption.whatsappCaption); setEdited(true);
      toast({ title: 'Caption written', description: 'Read it over before sending.' });
    } catch (e) {
      const dg = diagnose('caption', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
      toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    if (!pick) return;
    setBusy('send');
    try {
      const form = new FormData();
      const slug = pick.url.split('/').filter(Boolean).pop() || 'piece';
      form.set('file', new File([await photo(pick)], `${slug}.jpg`, { type: 'image/jpeg' }));
      form.set('caption', caption);
      form.set('sitePiece', pick.id);
      const res = await fetch('/api/website/post', { method: 'POST', headers: await authHeaders(), body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(d.error || `${res.status}`), { status: res.status });
      setPosted(prev => ({ ...prev, [pick.id]: new Date().toISOString() }));
      const ch = d.channel as { ok: boolean; error?: string } | null;
      toast({
        title: `Sent to ${audience.community?.name ?? 'the community'}`,
        description: ch ? (ch.ok ? `And to ${audience.channel?.name ?? 'the channel'}.` : `The channel didn’t take it: ${ch.error}`) : `${pick.name}, with its link.`,
        variant: ch && !ch.ok ? 'destructive' : undefined,
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
          Pick any piece from the website — or shuffle — and send it to {community ? <b>{community.name}</b> : 'the community'}{community?.size ? ` (${community.size.toLocaleString()} members)` : ''}{audience.channel ? <> and <b>{audience.channel.name}</b></> : null}, with its link.
        </p>
      </div>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{error} <button type="button" className="text-primary ml-2" onClick={load}>Try again</button></div>}
      {!community && pieces && <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">No WhatsApp community is set up for this shop yet (WHATSAPP_COMMUNITY_CHAT_ID), so nothing can be sent from here.</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* The piece to send — first on a phone, beside the grid on a computer. */}
        <aside className="order-1 lg:order-2 min-w-0 lg:sticky lg:top-4 self-start space-y-3">
          {pick ? (
            <div className="rounded-xl border overflow-hidden">
              <a href={pick.url} target="_blank" rel="noopener" className="block bg-muted"><img src={pick.image} alt={pick.name} className="w-full aspect-square object-cover" /></a>
              <div className="p-3 space-y-3">
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
                      {edited && <button type="button" className="text-xs text-muted-foreground inline-flex items-center gap-1" onClick={() => { setCaption(houseCaption(pick)); setEdited(false); }}><RotateCcw className="h-3 w-3" /> House caption</button>}
                      {STORE_POST_PIECE && <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={!!busy} onClick={writeWithAi}>{busy === 'ai' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />} Write with AI</Button>}
                    </div>
                  </div>
                  <Textarea value={caption} onChange={e => { setCaption(e.target.value); setEdited(true); }} rows={10} className="font-mono text-xs leading-relaxed" />
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Button className="h-11" disabled={!!busy || !community || !caption.trim()} onClick={() => setConfirm(true)}>
                    {busy === 'send' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />} Send to the community
                  </Button>
                  <Button variant="outline" className="h-11" disabled={!!busy} onClick={shuffle} aria-label="Another piece"><Shuffle className="h-4 w-4" /></Button>
                </div>
                <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" /> {community?.name ?? 'Community'}</span>
                  {audience.channel && <span className="inline-flex items-center gap-1"><Radio className="h-3 w-3" /> {audience.channel.name} too</span>}
                  <span>The photo goes as it is on the website.</span>
                </p>
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
            {['', ...collections].map(c => (
              <button key={c || 'all'} type="button" onClick={() => setCollection(c)}
                className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap', collection === c ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>{c || 'Everything'}</button>
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

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send it to {community?.name ?? 'the community'}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {pick && <div className="flex gap-3"><img src={pick.thumb} alt="" className="h-16 w-16 rounded-md object-cover" /><div><p className="font-medium text-foreground">{pick.name}</p><p className="text-xs">{community?.size ? `${community.size.toLocaleString()} members` : ''}{audience.channel ? ` · and ${audience.channel.name}${audience.channel.followers ? ` (${audience.channel.followers})` : ''}` : ''}</p></div></div>}
                <p className="text-xs">The photo as it is on the website, with the caption and its link. It can’t be unsent from here.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirm(false); send(); }}>Send</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
