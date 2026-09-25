'use client';

/**
 * Investments by Taheri — the daily gold post, read and sent from the POS.
 *
 * Each morning the scheduled Claude routine files the day's post here (words,
 * teaser, a square card and a story card; see src/lib/investments.ts). This
 * page shows the fortnight, newest first. The counter can change any word,
 * then send each part with one press:
 *
 *   the post and its square card → the Investments by Taheri group
 *   the teaser                   → the community's announcements
 *   the story card               → the Instagram story
 *
 * Each goes once; a sent part says when, and sending it again asks first. A day
 * can also be added by hand — the same four things, from anywhere.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { TrendingUp, Send, Check, Loader2, Copy, Download, Instagram, MessageCircle, Megaphone, Plus, RefreshCw, Clock, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { diagnose } from '@/lib/social/diagnose';
import { STORE_INVESTMENTS } from '@/lib/store-config';

type Target = 'group' | 'teaser' | 'instagram';
interface Sent { at: string; by: string; ref: string }
interface Post { id: string; date: string; post: string; teaser: string; cards: ('square' | 'story')[]; receivedAt: string; source: string; editedAt?: string; sent: Partial<Record<Target, Sent>> }

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

const TARGETS: { id: Target; label: string; to: string; icon: React.ReactNode }[] = [
  { id: 'group', label: 'Post + square card', to: 'the Investments by Taheri group', icon: <MessageCircle className="h-4 w-4" /> },
  { id: 'teaser', label: 'Teaser', to: 'the community’s announcements', icon: <Megaphone className="h-4 w-4" /> },
  { id: 'instagram', label: 'Story card', to: 'the Instagram story', icon: <Instagram className="h-4 w-4" /> },
];

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

export default function InvestmentsRoute() {
  // A wrapper, so the page's own hooks never sit behind an early return.
  if (!STORE_INVESTMENTS) {
    return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">Investments by Taheri isn't part of this shop.</p>;
  }
  return <InvestmentsPage />;
}

function InvestmentsPage() {
  const { toast } = useToast();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/investments', { headers: await authHeaders(), cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `${res.status}`);
      setPosts(d.posts);
      setToday(d.today);
    } catch (e) {
      toast({ title: 'Could not load the posts', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const todays = posts?.find(p => p.date === today);

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><TrendingUp className="mr-3 h-7 w-7" /> Investments by Taheri</h1>
          <p className="text-sm text-muted-foreground mt-1">The daily gold post arrives here every morning from the Claude routine. Read it, change anything, and send each part where it goes.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdding(a => !a)}><Plus className="h-4 w-4 mr-1.5" /> Add by hand</Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></Button>
        </div>
      </div>

      {posts && !todays && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm flex items-start gap-2">
          <Clock className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Today’s post hasn’t arrived yet.</p>
            <p className="text-muted-foreground text-xs">The routine runs at 11:00 and files it here when it finishes. If it ran and nothing came, check the routine’s last step (Send to the POS) on claude.ai — or add today’s by hand.</p>
          </div>
        </div>
      )}

      {adding && <AddByHand today={today} onDone={() => { setAdding(false); load(); }} />}

      {loading && !posts && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {posts?.length === 0 && <p className="text-sm text-muted-foreground">No posts yet. The first arrives with the routine’s next run.</p>}
      {posts?.map(p => <DayCard key={p.id} post={p} isToday={p.date === today} onChanged={load} />)}
    </div>
  );
}

function DayCard({ post: p, isToday, onChanged }: { post: Post; isToday: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(isToday);
  const [post, setPost] = useState(p.post);
  const [teaser, setTeaser] = useState(p.teaser);
  const [busy, setBusy] = useState<Target | null>(null);
  const [confirm, setConfirm] = useState<{ target: Target; force: boolean } | null>(null);
  useEffect(() => { setPost(p.post); setTeaser(p.teaser); }, [p.post, p.teaser]);

  const card = (kind: 'square' | 'story') => `/api/public/investments/${p.id}/${kind}?v=${encodeURIComponent(p.receivedAt)}`;
  const sentCount = TARGETS.filter(t => p.sent[t.id]).length;

  const send = async (target: Target, force: boolean) => {
    setBusy(target);
    try {
      const res = await fetch(`/api/investments/${p.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ target, force, ...(post !== p.post ? { post } : {}), ...(teaser !== p.teaser ? { teaser } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const where = target === 'instagram' ? 'instagram' : 'whatsapp';
        const dg = diagnose(where, { status: res.status, message: d.error || `${res.status}` });
        toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
        return;
      }
      toast({ title: 'Sent', description: `${TARGETS.find(t => t.id === target)!.label} went to ${TARGETS.find(t => t.id === target)!.to}.` });
      onChanged();
    } finally {
      setBusy(null);
    }
  };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); } catch { toast({ title: 'Could not copy', variant: 'destructive' }); }
  };

  return (
    <div className={cn('rounded-xl border', isToday && 'border-primary/40 shadow-sm')}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="flex-1 min-w-0">
          <span className="font-semibold">{longDate(p.date)}</span>{isToday && <span className="ml-2 text-xs rounded-full bg-primary/10 text-primary px-2 py-0.5">Today</span>}
          <span className="block text-xs text-muted-foreground truncate">{p.post.split('\n').find(l => l.trim())?.replace(/[*_]/g, '')}</span>
        </span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{sentCount}/3 sent</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t p-4 grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-4 min-w-0">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Post <span className="text-muted-foreground font-normal">· {post.length.toLocaleString()} characters{post.length > 1024 ? ' — sent under the card, too long for a caption' : ''}</span></Label>
                <button type="button" className="text-xs text-primary inline-flex items-center gap-1" onClick={() => copy(post, 'Post')}><Copy className="h-3 w-3" /> Copy</button>
              </div>
              <Textarea value={post} onChange={e => setPost(e.target.value)} rows={14} className="font-mono text-xs leading-relaxed" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Teaser <span className="text-muted-foreground font-normal">· for the main community</span></Label>
                <button type="button" className="text-xs text-primary inline-flex items-center gap-1" onClick={() => copy(teaser, 'Teaser')}><Copy className="h-3 w-3" /> Copy</button>
              </div>
              <Textarea value={teaser} onChange={e => setTeaser(e.target.value)} rows={8} className="font-mono text-xs leading-relaxed" />
            </div>
            {(post !== p.post || teaser !== p.teaser) && <p className="text-xs text-amber-600">You’ve changed the words — what you send now is your version, and it’s saved when it goes.</p>}
            <p className="text-[11px] text-muted-foreground">Arrived {time(p.receivedAt)} from {p.source === 'routine' ? 'the Claude routine' : 'the POS'}{p.editedAt ? ` · edited ${time(p.editedAt)}` : ''}</p>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(['square', 'story'] as const).map(k => p.cards.includes(k) ? (
                <a key={k} href={card(k)} target="_blank" rel="noopener" className="block">
                  <img src={card(k)} alt={`${k} card`} className={cn('w-full rounded-md border object-cover', k === 'square' ? 'aspect-square' : 'aspect-[9/16]')} />
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5"><Download className="h-3 w-3" /> {k === 'square' ? 'Square' : 'Story'}</span>
                </a>
              ) : <div key={k} className="rounded-md border-2 border-dashed text-[11px] text-muted-foreground flex items-center justify-center aspect-square">No {k} card</div>)}
            </div>
            <div className="space-y-2">
              {TARGETS.map(t => {
                const s = p.sent[t.id];
                const missing = (t.id === 'teaser' && !teaser.trim()) || (t.id === 'instagram' && !p.cards.includes('story'));
                return (
                  <div key={t.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      {t.icon}<span className="flex-1 font-medium">{t.label}</span>
                      {s ? <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> {time(s.at)}</span> : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">to {t.to}</p>
                    <Button size="sm" variant={s ? 'ghost' : 'default'} className="mt-1.5 w-full h-8" disabled={!!busy || missing}
                      onClick={() => setConfirm({ target: t.id, force: !!s })}>
                      {busy === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : s ? 'Send again…' : <><Send className="h-3.5 w-3.5 mr-1.5" /> Send</>}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={o => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.force ? 'Send it again?' : 'Send it now?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && `${TARGETS.find(t => t.id === confirm.target)!.label} for ${longDate(p.date)} goes to ${TARGETS.find(t => t.id === confirm.target)!.to}${confirm.force ? ' a second time — everyone will see it twice' : ''}. It can’t be unsent from here.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = confirm!; setConfirm(null); send(c.target, c.force); }}>{confirm?.force ? 'Send again' : 'Send'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddByHand({ today, onDone }: { today: string; onDone: () => void }) {
  const { toast } = useToast();
  const [date, setDate] = useState(today);
  const [post, setPost] = useState('');
  const [teaser, setTeaser] = useState('');
  const [squareFile, setSquareFile] = useState<File | null>(null);
  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set('date', date); form.set('post', post); form.set('teaser', teaser);
      if (squareFile) form.set('square', squareFile);
      if (storyFile) form.set('story', storyFile);
      const res = await fetch('/api/investments', { method: 'POST', headers: await authHeaders(), body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `${res.status}`);
      toast({ title: 'Filed', description: `${longDate(date)} is ready to send.` });
      onDone();
    } catch (e) {
      toast({ title: 'Could not file it', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border p-4 space-y-3">
      <p className="font-medium">Add a day by hand</p>
      <p className="text-xs text-muted-foreground">Paste the post and teaser, and attach the two cards (the routine’s taheri_square and taheri_story images). A day that already exists is replaced; anything already sent stays marked as sent.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
        <div className="space-y-1"><Label className="text-xs">Square card (1080×1080)</Label><Input type="file" accept="image/*" onChange={e => setSquareFile(e.target.files?.[0] ?? null)} /></div>
        <div className="space-y-1"><Label className="text-xs">Story card (1080×1920)</Label><Input type="file" accept="image/*" onChange={e => setStoryFile(e.target.files?.[0] ?? null)} /></div>
      </div>
      <Textarea value={post} onChange={e => setPost(e.target.value)} rows={8} placeholder="The WhatsApp post" className="font-mono text-xs" />
      <Textarea value={teaser} onChange={e => setTeaser(e.target.value)} rows={5} placeholder="The teaser (optional)" className="font-mono text-xs" />
      <Button onClick={save} disabled={busy || !post.trim() || !date}>{busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null} File it</Button>
    </div>
  );
}
