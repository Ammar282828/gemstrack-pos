'use client';

/**
 * Post a Piece's queue on the page: the pieces the counter has finished and
 * queued, and when each goes — now, all together, or spread over the day.
 * The server keeps them (src/lib/social/queue.ts) and the tick sends the
 * scheduled ones even with every screen closed; this shows the queue from any
 * device and lets the counter change it.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Check, Clock, Globe, Instagram, ListPlus, Loader2, MessageCircle, Radio, RotateCw, Send, Star, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { defaultSpreadEnd, spreadTimes, type QueueCounts, type QueueStatus, type QueueTargets } from '@/lib/social/queue-plan';

/** A queued piece as GET /api/website/post/queue returns it. */
export interface QueueEntry extends QueueTargets {
  id: string;
  createdAt: string;
  status: QueueStatus;
  dueAt: string | null;
  headline: string;
  caption: string;
  counts: QueueCounts;
  thumb: string | null;
  units: string[];
  done: Record<string, string>;
  errors: Record<string, { message: string; at: string }>;
  attempts: number;
  sentAt?: string;
}

/** A finished piece from the page, ready to be queued. */
export interface NewPiece {
  headline: string;
  caption: string;
  fileBase: string;
  targets: QueueTargets;
  site: Blob[];
  wa: Blob[];
  story: Blob | null;
  thumb: Blob | null;
}

/** "a", "a and b", "a, b and c". */
export const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

async function call<T = Record<string, unknown>>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeaders()), ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}) };
  const res = await fetch(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, cache: 'no-store' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error || `Failed (${res.status})`), { status: res.status, body: d });
  return d as T;
}

const base64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const pending = (e: QueueEntry) => e.status === 'held' || e.status === 'scheduled' || e.status === 'failed';

export function useQueue() {
  const { toast } = useToast();
  const [items, setItems] = useState<QueueEntry[]>([]);
  const [sending, setSending] = useState<string | null>(null);   // the id going now, from this page
  const [adding, setAdding] = useState<string | null>(null);     // what "Add to queue" is doing
  const load = useCallback(async () => {
    try { setItems((await call<{ items: QueueEntry[] }>('/api/website/post/queue')).items); } catch { /* the panel just stays as it was */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  // While something is due or going, keep the list fresh: the tick sends on the server.
  const live = items.some(e => e.status === 'scheduled' || e.status === 'sending');
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [live, load]);
  const put = (e: QueueEntry) => setItems(prev => prev.map(x => x.id === e.id ? e : x));

  /** Upload a finished piece: the draft, then its images one by one, then it joins the queue (held). */
  const add = async (p: NewPiece): Promise<boolean> => {
    let id: string | null = null;
    try {
      setAdding('Keeping it…');
      const { item } = await call<{ item: QueueEntry }>('/api/website/post/queue', { method: 'POST', json: {
        headline: p.headline, caption: p.caption, fileBase: p.fileBase,
        counts: { site: p.site.length, wa: p.wa.length, story: !!p.story },
        website: p.targets.website, instagram: p.targets.instagram, whatsapp: p.targets.whatsapp,
        ...(p.thumb ? { thumb: await base64(p.thumb) } : {}),
      } });
      id = item.id;
      const files: [string, Blob][] = [
        ...(p.targets.website ? p.site.map((b, i) => [`site-${i}`, b] as [string, Blob]) : []),
        ...(p.targets.whatsapp.length ? p.wa.map((b, i) => [`wa-${i}`, b] as [string, Blob]) : []),
        ...(p.targets.instagram && p.story ? [['story', p.story] as [string, Blob]] : []),
      ];
      for (let i = 0; i < files.length; i++) {
        setAdding(`Keeping it… ${i + 1} of ${files.length}`);
        const form = new FormData();
        form.set('key', files[i][0]);
        form.set('file', new File([files[i][1]], `${files[i][0]}.jpg`, { type: 'image/jpeg' }));
        await call(`/api/website/post/queue/${id}`, { method: 'POST', body: form });
      }
      const { item: ready } = await call<{ item: QueueEntry }>(`/api/website/post/queue/${id}`, { method: 'PATCH', json: { action: 'ready' } });
      setItems(prev => [...prev.filter(x => x.id !== ready.id), ready]);
      return true;
    } catch (e) {
      if (id) call(`/api/website/post/queue/${id}`, { method: 'DELETE' }).catch(() => undefined);
      toast({ title: 'Could not queue it', description: e instanceof Error ? e.message : 'Try again.', variant: 'destructive' });
      return false;
    } finally {
      setAdding(null);
    }
  };

  const sendNow = async (id: string) => {
    setSending(id);
    setItems(prev => prev.map(x => x.id === id ? { ...x, status: 'sending' } : x));
    try {
      const d = await call<{ ok: boolean; item: QueueEntry }>(`/api/website/post/queue/${id}/send`, { method: 'POST' });
      put(d.item);
      return d.ok;
    } catch (e) {
      const body = (e as { body?: { item?: QueueEntry } }).body;
      if (body?.item) put(body.item);
      toast({ title: 'Not sent', description: e instanceof Error ? e.message : '', variant: 'destructive' });
      return false;
    } finally {
      setSending(null);
    }
  };
  const sendAll = async () => {
    const ids = items.filter(pending).map(e => e.id);
    let ok = 0;
    for (const id of ids) if (await sendNow(id)) ok++;
    toast({ title: ok === ids.length ? `All ${ids.length} sent` : `${ok} of ${ids.length} sent`, description: ok === ids.length ? undefined : 'The ones that failed say why; Retry sends only what didn’t go.', variant: ok === ids.length ? undefined : 'destructive' });
    load();
  };
  const schedule = async (id: string, at: Date) => {
    try { put((await call<{ item: QueueEntry }>(`/api/website/post/queue/${id}`, { method: 'PATCH', json: { action: 'schedule', dueAt: at.toISOString() } })).item); }
    catch (e) { toast({ title: 'Could not set the time', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
  };
  const hold = async (id: string) => {
    try { put((await call<{ item: QueueEntry }>(`/api/website/post/queue/${id}`, { method: 'PATCH', json: { action: 'hold' } })).item); }
    catch (e) { toast({ title: 'Could not hold it', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
  };
  const remove = async (id: string) => {
    try { await call(`/api/website/post/queue/${id}`, { method: 'DELETE' }); setItems(prev => prev.filter(x => x.id !== id)); }
    catch (e) { toast({ title: 'Could not remove it', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
  };
  const spread = async (from: Date, to: Date) => {
    const list = items.filter(pending);
    const times = spreadTimes(list.length, from, to);
    for (let i = 0; i < list.length; i++) await schedule(list[i].id, times[i]);
    toast({ title: `${list.length} piece${list.length === 1 ? '' : 's'} spread from ${clock(times[0])} to ${clock(times[times.length - 1])}`, description: 'They go by themselves — this page can be closed.' });
  };
  return { items, load, add, adding, sendNow, sendAll, sending, schedule, hold, remove, spread };
}

export type QueueApi = ReturnType<typeof useQueue>;

const clock = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const whenText = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  return sameDay(d, now) ? clock(d) : sameDay(d, tomorrow) ? `tomorrow ${clock(d)}` : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${clock(d)}`;
};
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** "16:35" → today at 16:35, or tomorrow if that has passed. */
function atTime(v: string, now = new Date()): Date | null {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(now); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() < now.getTime() - 60_000) d.setDate(d.getDate() + 1);
  return d;
}
/** The next five-minute mark at least `min` minutes away. */
function soon(min: number, now = new Date()) {
  const d = new Date(now.getTime() + min * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}

export function QueuePanel({ api, destinationName, blockers }: {
  api: QueueApi;
  /** A WhatsApp destination key's name ("Announcements", "Taheri Collections"). */
  destinationName: (key: string) => string;
  /** Failing checks for where the queue is about to send, as the page's publish confirm lists them. */
  blockers: (entries: QueueEntry[]) => { id: string; label: string; fix?: string; detail: string }[];
}) {
  const { items, sending, sendNow, sendAll, schedule, hold, remove, spread } = api;
  const [confirmAll, setConfirmAll] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [showSent, setShowSent] = useState(false);
  const timeRef = useRef<HTMLInputElement>(null);

  const waiting = items.filter(pending);
  const going = items.filter(e => e.status === 'sending');
  const sent = items.filter(e => e.status === 'sent' && sameDay(new Date(e.sentAt || e.createdAt), new Date()));
  if (!items.length) return null;

  const openSpread = () => {
    const f = soon(10), end = defaultSpreadEnd(new Date());
    setFrom(hhmm(f));
    setTo(hhmm(end.getTime() > f.getTime() ? end : f));
    setSpreadOpen(true);
  };
  const fromAt = atTime(from);
  // The last time is on the first one's day: a "last" before the "first" just sends them all at the first.
  const toAt = fromAt && /^\d{1,2}:\d{2}$/.test(to) ? (() => { const d = new Date(fromAt); const [h, m] = to.split(':').map(Number); d.setHours(h, m, 0, 0); return d; })() : null;
  const preview = fromAt && toAt ? spreadTimes(waiting.length, fromAt, toAt) : [];
  const where = (e: QueueEntry) => [
    e.website && `${e.website.collection}${e.website.featured ? ' (set of the day)' : ''}`,
    e.instagram && 'Instagram',
    ...e.whatsapp.map(k => (k === 'channel' ? 'the channel' : destinationName(k))),
  ].filter(Boolean) as string[];
  const allBlockers = blockers(waiting);

  const row = (e: QueueEntry) => {
    const left = e.units.filter(u => !e.done[u]);
    const firstError = Object.values(e.errors ?? {})[0]?.message;
    const busy = sending === e.id || e.status === 'sending';
    return (
      <li key={e.id} className="flex items-start gap-2.5 py-2">
        {e.thumb ? <img src={e.thumb} alt="" className="h-12 w-12 rounded-md object-cover shrink-0" /> : <span className="h-12 w-12 rounded-md bg-muted shrink-0" />}
        <div className="flex-1 min-w-0 space-y-0.5">
          <p className="text-sm font-medium truncate">{e.headline || 'Untitled piece'}</p>
          <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-1.5">
            {e.website && <Globe className="h-3 w-3" />}{e.website?.featured && <Star className="h-3 w-3" />}{e.instagram && <Instagram className="h-3 w-3" />}
            {e.whatsapp.filter(k => k !== 'channel').length > 0 && <MessageCircle className="h-3 w-3" />}{e.whatsapp.includes('channel') && <Radio className="h-3 w-3" />}
            <span className="truncate">{listOf(where(e))}</span>
          </p>
          <p className={cn('text-xs flex items-center gap-1', e.status === 'failed' ? 'text-destructive' : e.status === 'sent' ? 'text-emerald-600' : 'text-muted-foreground')}>
            {busy ? <><Loader2 className="h-3 w-3 animate-spin" /> Sending…</>
              : e.status === 'sent' ? <><Check className="h-3 w-3" /> Sent {e.sentAt ? clock(new Date(e.sentAt)) : ''}</>
              : e.status === 'failed' ? <><X className="h-3 w-3" /> {left.length} of {e.units.length} didn’t go{firstError ? `: ${firstError}` : ''}{e.dueAt && e.attempts < 3 ? ' — tries again in a few minutes' : ''}</>
              : e.status === 'scheduled' && e.dueAt ? <><Clock className="h-3 w-3" /> Goes at {whenText(e.dueAt)}</>
              : 'Waiting — send it now or give it a time'}
          </p>
          {editing === e.id && (
            <div className="flex items-center gap-1.5 pt-1">
              <Input ref={timeRef} type="time" defaultValue={e.dueAt ? hhmm(new Date(e.dueAt)) : hhmm(soon(10))} className="h-8 w-28 text-xs" />
              <Button size="sm" className="h-8" onClick={() => { const at = atTime(timeRef.current?.value || ''); if (at) { schedule(e.id, at); setEditing(null); } }}>Set</Button>
              {e.status === 'scheduled' && <Button size="sm" variant="ghost" className="h-8" onClick={() => { hold(e.id); setEditing(null); }}>Hold</Button>}
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          )}
        </div>
        {pending(e) && !busy && editing !== e.id && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" title="Give it a time" onClick={() => setEditing(e.id)} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted"><Clock className="h-4 w-4" /></button>
            <button type="button" title={e.status === 'failed' ? 'Retry what didn’t go' : 'Send it now'} disabled={!!sending} onClick={() => sendNow(e.id)} className="h-8 w-8 rounded-md flex items-center justify-center text-primary hover:bg-primary/10 disabled:opacity-40">
              {e.status === 'failed' ? <RotateCw className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
            <button type="button" title="Take it out of the queue" disabled={!!sending} onClick={() => remove(e.id)} className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium flex items-center gap-2"><ListPlus className="h-4 w-4" /> Queue{waiting.length ? <span className="text-muted-foreground font-normal text-sm">· {waiting.length} to go</span> : null}</p>
      </div>
      {(waiting.length > 0 || going.length > 0) && <ul className="divide-y">{[...going, ...waiting].map(row)}</ul>}
      {waiting.length > 0 && (
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button size="sm" disabled={!!sending} onClick={() => setConfirmAll(true)}>
            {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />} Send {waiting.length > 1 ? `all ${waiting.length}` : 'it'} now
          </Button>
          <Button size="sm" variant="secondary" disabled={!!sending} onClick={openSpread}><Clock className="h-4 w-4 mr-1.5" /> Spread over the day</Button>
        </div>
      )}
      {sent.length > 0 && (
        <div className="border-t pt-2">
          <button type="button" className="text-xs text-muted-foreground" onClick={() => setShowSent(v => !v)}>{sent.length} sent today {showSent ? '▴' : '▾'}</button>
          {showSent && <ul className="divide-y">{sent.map(row)}</ul>}
        </div>
      )}

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send {waiting.length > 1 ? `all ${waiting.length} pieces` : 'it'} now?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1.5">
                <ul className="text-xs space-y-1">{waiting.map(e => <li key={e.id}><span className="font-medium text-foreground">{e.headline || 'Untitled'}</span> → {listOf(where(e))}</li>)}</ul>
                <p>One after another, in this order. A post cannot be unsent from here.</p>
                {allBlockers.length > 0 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-2 text-foreground">
                    <p className="font-semibold text-destructive">This will probably fail:</p>
                    {allBlockers.map(c => <p key={c.id} className="text-xs"><span className="font-medium">{c.label}</span> — {c.fix ?? c.detail}</p>)}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmAll(false); sendAll(); }}>{allBlockers.length ? 'Send anyway' : 'Send'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={spreadOpen} onOpenChange={setSpreadOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Spread over the day</DialogTitle>
            <DialogDescription>The {waiting.length} piece{waiting.length === 1 ? '' : 's'} go{waiting.length === 1 ? 'es' : ''} out evenly between these times, in the queue’s order, each to wherever it was set to go. They go by themselves — nobody needs to be on this page.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label htmlFor="spread-from">First</Label><Input id="spread-from" type="time" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="spread-to">Last</Label><Input id="spread-to" type="time" value={to} onChange={e => setTo(e.target.value)} /></div>
          </div>
          {preview.length > 0 && (
            <ul className="text-sm space-y-1">
              {waiting.map((e, i) => (
                <li key={e.id} className="flex items-center justify-between gap-3"><span className="truncate">{e.headline || 'Untitled'}</span><span className="tabular-nums text-muted-foreground shrink-0">{whenText(preview[i].toISOString())}</span></li>
              ))}
            </ul>
          )}
          {allBlockers.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-1 text-xs">
              <p className="font-semibold text-destructive">Something they need is failing now:</p>
              {allBlockers.map(c => <p key={c.id}><span className="font-medium">{c.label}</span> — {c.fix ?? c.detail}</p>)}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSpreadOpen(false)}>Cancel</Button>
            <Button disabled={!fromAt || !toAt} onClick={() => { if (fromAt && toAt) { setSpreadOpen(false); spread(fromAt, toAt); } }}><Clock className="h-4 w-4 mr-1.5" /> Schedule them</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
