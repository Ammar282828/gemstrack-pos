'use client';

/**
 * The studio's competitors: found by Google Search or added by hand, looked up on
 * Instagram through the house's own connection (public business accounts only), read
 * by the model for what works in their feed and what Taheri should do differently —
 * and their live ads one tap away in Meta's public Ad Library, since Meta gives no API
 * for other advertisers' ads in Pakistan.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Search, Plus, Trash2, ExternalLink, Instagram, Library, Sparkles, RefreshCw, Heart, MessageCircle, Globe, ChevronDown, ChevronUp, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Competitor } from '@/lib/ads/studio/research';
import type { FoundCompetitor } from '@/lib/ads/studio/prompts';
import { api } from '../ads-kit';

type Row = Competitor & { adLibrary: string; instagram: string; profile: (Competitor['profile'] & { posts: (NonNullable<Competitor['profile']>['posts'][number] & { rate?: number | null })[] }) | null };
type Found = FoundCompetitor & { adLibrary: string };

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

export function RivalsSection({ connected }: { connected: boolean }) {
  const { toast } = useToast();
  const [list, setList] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [brief, setBrief] = useState('');
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList((await api<{ competitors: Row[] }>('/api/ads/studio/competitors')).competitors); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const find = async () => {
    setFinding(true);
    try { setFound((await api<{ found: Found[] }>('/api/ads/studio/competitors', { body: { action: 'find', brief } })).found); }
    catch (e) { toast({ title: 'The search didn’t work', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setFinding(false); }
  };
  const add = async (c: { username: string; name?: string; website?: string; city?: string; why?: string; source: 'search' | 'owner' }) => {
    try {
      const { competitor } = await api<{ competitor: Row }>('/api/ads/studio/competitors', { body: { action: 'add', ...c } });
      setList(l => [competitor, ...(l ?? []).filter(x => x.username !== competitor.username)]);
      setFound(f => f?.filter(x => x.instagram !== competitor.username) ?? null);
      setOpen(competitor.username);
    } catch (e) { toast({ title: 'Couldn’t add it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };
  const remove = async (u: string) => {
    await api('/api/ads/studio/competitors', { body: { action: 'remove', username: u } }).catch(() => undefined);
    setList(l => l?.filter(x => x.username !== u) ?? null);
  };
  const update = (r: Row) => setList(l => l?.map(x => (x.username === r.username ? r : x)) ?? null);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-3 sm:p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold">Who else sells to the same buyers</p>
          <p className="text-xs text-muted-foreground">Search finds Karachi’s and Pakistan’s fine jewellers and their Instagram; each one is then looked up on Instagram through the house’s own account — followers, recent posts, what each post earned — and read for what works. Their running ads open in Meta’s public Ad Library (Meta shares no one’s ads through its API in Pakistan).</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input value={brief} onChange={e => setBrief(e.target.value)} placeholder="Focus (optional) — e.g. diamond boutiques in Clifton, Bohri Bazaar jewellers" className="h-9 text-base sm:text-sm" />
          <Button onClick={find} disabled={finding}>{finding ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Search className="h-4 w-4 mr-1.5" />} Find competitors</Button>
        </div>
        {finding && <p className="text-[11px] text-muted-foreground">Searching Google — about a minute.</p>}
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (typed.trim()) { add({ username: typed, source: 'owner' }); setTyped(''); } }}>
          <Input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Or add one: @username or their Instagram link" className="h-9 text-base sm:text-sm" />
          <Button type="submit" variant="outline" disabled={!typed.trim()}><Plus className="h-4 w-4 mr-1" /> Add</Button>
        </form>
        {found && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">{found.length ? `Found ${found.length} — add the ones that matter:` : 'Nothing new found.'}</p>
            {found.map(f => (
              <div key={f.name + f.instagram} className="flex items-start gap-2 rounded-lg border p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{f.name} <span className="text-xs text-muted-foreground font-normal">{f.instagram ? `@${f.instagram}` : 'no Instagram found'}{f.city ? ` · ${f.city}` : ''}</span></p>
                  <p className="text-[11px] text-muted-foreground">{f.why}</p>
                  <div className="flex gap-3 text-[11px] mt-0.5">
                    <a href={f.adLibrary} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5"><Library className="h-3 w-3" /> Their ads</a>
                    {f.website && <a href={f.website} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-0.5"><Globe className="h-3 w-3" /> Website</a>}
                  </div>
                </div>
                <Button size="sm" variant="outline" disabled={!f.instagram} onClick={() => add({ username: f.instagram, name: f.name, website: f.website, city: f.city, why: f.why, source: 'search' })}><Plus className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!connected && <p className="text-xs text-amber-700 dark:text-amber-400">Meta isn’t connected on Ads → Setup, so competitors can be listed but not looked up on Instagram yet.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {list === null ? <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…</div>
        : list.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No competitors yet — find some, or add the ones you already watch.</p>
          : <div className="space-y-2">{list.map(c => <RivalCard key={c.username} c={c} open={open === c.username} onToggle={() => setOpen(open === c.username ? null : c.username)} onChange={update} onRemove={() => remove(c.username)} canLook={connected} />)}</div>}
    </div>
  );
}

function RivalCard({ c, open, onToggle, onChange, onRemove, canLook }: { c: Row; open: boolean; onToggle: () => void; onChange: (r: Row) => void; onRemove: () => void; canLook: boolean }) {
  const { toast } = useToast();
  const [looking, setLooking] = useState(false);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(c.profileError);

  const look = useCallback(async (fresh = false) => {
    setLooking(true); setErr(null);
    try { onChange((await api<{ competitor: Row }>(`/api/ads/studio/competitors/${encodeURIComponent(c.username)}${fresh ? '?fresh=1' : ''}`)).competitor); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLooking(false); }
  }, [c.username, onChange]);
  useEffect(() => { if (open && !c.profile && !looking && canLook && !err) look(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const read = async () => {
    setReading(true);
    try { onChange((await api<{ competitor: Row }>(`/api/ads/studio/competitors/${encodeURIComponent(c.username)}`, { method: 'POST' })).competitor); }
    catch (e) { toast({ title: 'Couldn’t read their feed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setReading(false); }
  };

  const p = c.profile;
  const posts = [...(p?.posts ?? [])].sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  const r = c.reading;
  return (
    <div className="rounded-xl border overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40">
        {p?.picture ? <img src={p.picture} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" /> : <span className="h-10 w-10 rounded-full bg-muted grid place-items-center shrink-0"><Users className="h-4 w-4 text-muted-foreground" /></span>}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{c.name} <span className="text-xs text-muted-foreground font-normal">@{c.username}</span></p>
          <p className="text-[11px] text-muted-foreground truncate">{p ? `${k(p.followers)} followers · ${p.mediaCount} posts` : c.why || (c.city ? c.city : 'Not looked up yet')}{r ? ' · read' : ''}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
      </button>
      {open && (
        <div className="border-t p-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <a href={c.instagram} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Instagram className="h-4 w-4 mr-1" /> Instagram</Button></a>
            <a href={c.adLibrary} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Library className="h-4 w-4 mr-1" /> Their live ads</Button></a>
            {(p?.website || c.website) && <a href={(p?.website || c.website)!} target="_blank" rel="noreferrer"><Button size="sm" variant="outline"><Globe className="h-4 w-4 mr-1" /> Website</Button></a>}
            <Button size="sm" variant="ghost" disabled={looking || !canLook} onClick={() => look(true)}><RefreshCw className={cn('h-4 w-4 mr-1', looking && 'animate-spin')} /> Look again</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}><Trash2 className="h-4 w-4 mr-1" /> Remove</Button>
          </div>
          {err && <p className="text-xs text-destructive">{err}</p>}
          {looking && !p && <p className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 inline animate-spin mr-1" /> Looking them up on Instagram…</p>}
          {p && (
            <>
              {p.bio && <p className="text-xs whitespace-pre-line text-muted-foreground">{p.bio}</p>}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">Their last {posts.length} posts, best first <span className="text-muted-foreground font-normal">(likes + comments per thousand followers)</span></p>
                <Button size="sm" disabled={reading} onClick={read}>{reading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />} {r ? 'Read again' : 'Read their feed'}</Button>
              </div>
              {reading && <p className="text-[11px] text-muted-foreground">Looking at their best and weakest posts — about a minute.</p>}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {posts.slice(0, 12).map(x => (
                  <a key={x.id} href={x.permalink ?? '#'} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden rounded-md bg-muted" title={x.caption.slice(0, 200)}>
                    {x.image && <img src={x.image} alt="" loading="lazy" className="h-full w-full object-cover" />}
                    <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[9px] px-1 py-0.5 flex items-center gap-1.5">
                      {x.likes !== null ? <><Heart className="h-2.5 w-2.5" />{k(x.likes)}</> : 'likes hidden'}
                      {x.comments !== null && <><MessageCircle className="h-2.5 w-2.5" />{k(x.comments)}</>}
                      {x.rate !== null && x.rate !== undefined && <span className="ml-auto">{x.rate}‰</span>}
                    </span>
                  </a>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Looked up {c.profileAt ? new Date(c.profileAt).toLocaleString() : ''}. Their images open on Instagram.</p>
            </>
          )}
          {r && (
            <div className="rounded-xl bg-muted/50 p-3 space-y-2 text-xs">
              <p><b>Where they stand:</b> {r.positioning}</p>
              <p><b>How they look:</b> {r.visualStyle}</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><p className="font-semibold">Works for them</p><ul className="list-disc pl-4">{r.whatWorks.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
                <div><p className="font-semibold">Doesn’t</p><ul className="list-disc pl-4">{r.whatDoesnt.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-background p-2"><p className="font-semibold text-primary">What taheri should do</p><ul className="list-disc pl-4">{r.ourMoves.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
              {r.avoid.length > 0 && <div><p className="font-semibold">Don’t copy</p><ul className="list-disc pl-4">{r.avoid.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
              <p className="text-[10px] text-muted-foreground">Read {c.readingAt ? new Date(c.readingAt).toLocaleString() : ''}.</p>
            </div>
          )}
          {!p && !looking && !err && !canLook && <p className="text-xs text-muted-foreground">Connect Meta on Ads → Setup to look them up. <a className="text-primary inline-flex items-center gap-0.5" href={c.instagram} target="_blank" rel="noreferrer">Instagram <ExternalLink className="h-3 w-3" /></a></p>}
        </div>
      )}
    </div>
  );
}
