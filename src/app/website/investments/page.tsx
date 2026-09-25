'use client';

/**
 * Investments by Taheri — the daily gold post, read and sent from the POS.
 *
 * Each morning the scheduled Claude routine files the day's post here (words,
 * teaser, a square card and a story card; see src/lib/investments.ts). This
 * page shows the fortnight, newest first. The counter can change any word,
 * then send each part — or all of them at once — where it goes:
 *
 *   the post and its square card → the Investments by Taheri group
 *   the post and its square card → the WhatsApp channel (when the line is on WAHA)
 *   the teaser                   → the community's announcements
 *   the story card               → the Instagram story
 *
 * Or let it go by itself: Automatic sending at the top sets the days, each
 * part's time (or "as soon as it arrives"), a late cut-off, and whether each
 * day waits for an OK (src/lib/investments-schedule.ts). Today's card says
 * what the schedule will do with each part, and can hold the day back.
 *
 * Each part goes once; a sent part says when, and sending it again asks first.
 * A day can also be added by hand — the same four things, from anywhere.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  TrendingUp, Send, Check, Loader2, Copy, Download, Instagram, MessageCircle, Megaphone, Plus, RefreshCw, Clock, ChevronDown, Radio, CalendarClock, Pause, Play,
  ShieldCheck, AlertTriangle, RotateCw, SendHorizonal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { diagnose } from '@/lib/social/diagnose';
import { STORE_INVESTMENTS } from '@/lib/store-config';
import {
  DAY_NAMES, DEFAULT_SCHEDULE, TARGET_ORDER, clock, daysLabel, karachiNow, statusOf,
  type KarachiNow, type Schedule, type Status, type Target,
} from '@/lib/investments-schedule';

interface Sent { at: string; by: string; ref: string }
interface Post {
  id: string; date: string; post: string; teaser: string; cards: ('square' | 'story')[]; receivedAt: string; source: string; editedAt?: string;
  sent: Partial<Record<Target, Sent>>; hold?: boolean; approved?: { at: string; by: string } | null;
  auto?: Partial<Record<Target, { tries?: number; error?: string; lastTry?: string; claimedAt?: string }>>;
}
type Destinations = Record<Target, boolean>;

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

const TARGETS: Record<Target, { label: string; to: string; icon: React.ReactNode }> = {
  group: { label: 'Post + square card', to: 'the Investments by Taheri group', icon: <MessageCircle className="h-4 w-4" /> },
  channel: { label: 'Post + square card', to: 'the WhatsApp channel', icon: <Radio className="h-4 w-4" /> },
  teaser: { label: 'Teaser', to: 'the community’s announcements', icon: <Megaphone className="h-4 w-4" /> },
  instagram: { label: 'Story card', to: 'the Instagram story', icon: <Instagram className="h-4 w-4" /> },
};

const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const ago = (iso?: string) => {
  if (!iso) return null;
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

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
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [destinations, setDestinations] = useState<Destinations | null>(null);
  // The clock the day cards read their "goes at 11:30" from; ticks every half minute.
  const [now, setNow] = useState<KarachiNow>(() => karachiNow());
  useEffect(() => { const t = setInterval(() => setNow(karachiNow()), 30_000); return () => clearInterval(t); }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const headers = await authHeaders();
      const [pr, sr] = await Promise.all([
        fetch('/api/investments', { headers, cache: 'no-store' }),
        fetch('/api/investments/schedule', { headers, cache: 'no-store' }),
      ]);
      const d = await pr.json();
      if (!pr.ok) throw new Error(d.error || `${pr.status}`);
      setPosts(d.posts);
      setToday(d.today);
      if (sr.ok) { const s = await sr.json(); setSchedule(s.schedule); setDestinations(s.destinations); }
    } catch (e) {
      if (!quiet) toast({ title: 'Could not load the posts', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  // While the schedule is on, what it sends shows up here without a reload.
  useEffect(() => {
    if (!schedule?.enabled) return;
    const t = setInterval(() => load(true), 60_000);
    return () => clearInterval(t);
  }, [schedule?.enabled, load]);

  const todays = posts?.find(p => p.date === today);
  const shown = TARGET_ORDER.filter(t => destinations ? destinations[t] : t !== 'channel');

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><TrendingUp className="mr-3 h-7 w-7" /> Investments by Taheri</h1>
          <p className="text-sm text-muted-foreground mt-1">The daily gold post arrives here every morning from the Claude routine. Read it, change anything, and send it — by hand, or on your schedule.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdding(a => !a)}><Plus className="h-4 w-4 mr-1.5" /> Add by hand</Button>
          <Button variant="ghost" size="sm" onClick={() => load()} disabled={loading} aria-label="Reload"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></Button>
        </div>
      </div>

      {schedule && destinations && <SchedulePanel schedule={schedule} destinations={destinations} onSaved={s => setSchedule(s)} />}

      {posts && !todays && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm flex items-start gap-2">
          <Clock className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Today’s post hasn’t arrived yet.</p>
            <p className="text-muted-foreground text-xs">The routine runs at 11:00 and files it here when it finishes{schedule?.enabled ? '; the schedule sends it once it’s here' : ''}. If it ran and nothing came, check the routine’s last step (Send to the POS) on claude.ai — or add today’s by hand.</p>
          </div>
        </div>
      )}

      {adding && <AddByHand today={today} onDone={() => { setAdding(false); load(); }} />}

      {loading && !posts && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {posts?.length === 0 && <p className="text-sm text-muted-foreground">No posts yet. The first arrives with the routine’s next run.</p>}
      {posts?.map(p => <DayCard key={p.id} post={p} isToday={p.date === today} targets={shown} schedule={schedule} now={now} onChanged={() => load(true)} />)}
    </div>
  );
}

// ── Automatic sending ──────────────────────────────────────────────────────

function SchedulePanel({ schedule, destinations, onSaved }: { schedule: Schedule; destinations: Destinations; onSaved: (s: Schedule) => void }) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Schedule>(schedule);
  const [open, setOpen] = useState(!schedule.enabled);
  const [saving, setSaving] = useState(false);
  const [confirmOn, setConfirmOn] = useState(false);
  useEffect(() => { setDraft(schedule); }, [schedule]);

  const strip = (s: Schedule) => JSON.stringify({ ...s, lastTick: undefined, updatedAt: undefined, updatedBy: undefined });
  const dirty = strip(draft) !== strip(schedule);
  const usable = TARGET_ORDER.filter(t => destinations[t]);
  const going = usable.filter(t => draft.targets[t].on);
  const setTarget = (t: Target, patch: Partial<Schedule['targets'][Target]>) => setDraft(d => ({ ...d, targets: { ...d.targets, [t]: { ...d.targets[t], ...patch } } }));
  const toggleDay = (n: number) => setDraft(d => ({ ...d, days: d.days.includes(n) ? d.days.filter(x => x !== n) : [...d.days, n].sort() }));

  const save = async (next: Schedule) => {
    setSaving(true);
    try {
      const res = await fetch('/api/investments/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ schedule: next }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `${res.status}`);
      onSaved(d.schedule);
      toast({ title: d.schedule.enabled ? 'Schedule saved — it’s on' : 'Saved — automatic sending is off' });
    } catch (e) {
      toast({ title: 'Could not save the schedule', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };
  // Turning it on says exactly what will go out, where; turning it off is immediate.
  const flip = (on: boolean) => { if (on) setConfirmOn(true); else save({ ...draft, enabled: false }); };

  const summary = (s: Schedule) => {
    const parts = usable.filter(t => s.targets[t].on).map(t => `${t === 'teaser' ? 'teaser' : t === 'instagram' ? 'Instagram' : t === 'channel' ? 'channel' : 'group'} ${s.targets[t].at === 'arrival' ? 'on arrival' : clock(s.targets[t].at)}`);
    return `${daysLabel(s.days)} · ${parts.join(' · ') || 'nothing chosen'}${s.mode === 'approve' ? ' · after your OK' : ''}`;
  };
  const tickAge = schedule.lastTick ? Date.now() - Date.parse(schedule.lastTick) : Infinity;

  return (
    <div className={cn('rounded-xl border', schedule.enabled ? 'border-emerald-500/40 bg-emerald-500/[0.03]' : '')}>
      <div className="flex items-center gap-3 px-4 py-3">
        <CalendarClock className={cn('h-5 w-5 shrink-0', schedule.enabled ? 'text-emerald-600' : 'text-muted-foreground')} />
        <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setOpen(o => !o)}>
          <span className="font-semibold">Automatic sending</span>
          <span className="block text-xs text-muted-foreground truncate">{schedule.enabled ? summary(schedule) : 'Off — nothing goes out unless someone presses Send.'}</span>
        </button>
        <Switch checked={schedule.enabled} disabled={saving} onCheckedChange={flip} aria-label="Automatic sending" />
        <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? 'Hide the schedule' : 'Edit the schedule'}><ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /></button>
      </div>
      {schedule.enabled && tickAge > 15 * 60_000 && (
        <p className="mx-4 mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {schedule.lastTick ? `The scheduler last checked in ${ago(schedule.lastTick)}. It should every 5 minutes — until it does, nothing goes out by itself.` : 'The scheduler hasn’t checked in yet. It runs every 5 minutes; if this stays, nothing goes out by itself.'}
        </p>
      )}

      {open && (
        <div className="border-t px-4 py-4 space-y-5">
          <div className="space-y-2">
            <Label>Which days</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map(n => (
                <button key={n} type="button" onClick={() => toggleDay(n)}
                  className={cn('h-9 min-w-11 rounded-full border px-3 text-sm', draft.days.includes(n) ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}>{DAY_NAMES[n]}</button>
              ))}
              <span className="mx-1 h-5 w-px bg-border" />
              {([['Every day', [0, 1, 2, 3, 4, 5, 6]], ['Mon–Sat', [1, 2, 3, 4, 5, 6]], ['Mon–Fri', [1, 2, 3, 4, 5]]] as [string, number[]][]).map(([label, days]) => (
                <button key={label} type="button" onClick={() => setDraft(d => ({ ...d, days }))} className="text-xs text-primary px-1.5">{label}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>What goes, and when <span className="font-normal text-muted-foreground">· Karachi time</span></Label>
            <div className="space-y-2">
              {usable.map(t => {
                const plan = draft.targets[t];
                return (
                  <div key={t} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2', !plan.on && 'opacity-70')}>
                    <Switch checked={plan.on} onCheckedChange={v => setTarget(t, { on: v })} aria-label={`${TARGETS[t].label} to ${TARGETS[t].to}`} />
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">{TARGETS[t].icon}<span className="min-w-0"><span className="font-medium">{TARGETS[t].label}</span> <span className="text-muted-foreground">to {TARGETS[t].to}</span></span></span>
                    {plan.on && (
                      <div className="flex items-center gap-2">
                        <div className="inline-flex rounded-full border p-0.5 text-xs">
                          <button type="button" onClick={() => setTarget(t, { at: 'arrival' })} className={cn('rounded-full px-2.5 py-1', plan.at === 'arrival' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>On arrival</button>
                          <button type="button" onClick={() => setTarget(t, { at: plan.at === 'arrival' ? DEFAULT_SCHEDULE.targets[t].at : plan.at })} className={cn('rounded-full px-2.5 py-1', plan.at !== 'arrival' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>At</button>
                        </div>
                        {plan.at !== 'arrival' && <Input type="time" step={300} value={plan.at} onChange={e => e.target.value && setTarget(t, { at: e.target.value })} className="h-9 w-[7.5rem]" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>If the post comes late</Label>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">still send it until</span>
                <Input type="time" step={300} value={draft.lateUntil} onChange={e => e.target.value && setDraft(d => ({ ...d, lateUntil: e.target.value }))} className="h-9 w-[7.5rem]" />
              </div>
              <p className="text-[11px] text-muted-foreground">After that, a part that hasn’t gone waits for someone to press Send.</p>
            </div>
            <div className="space-y-2">
              <Label>Each day</Label>
              <div className="inline-flex rounded-full border p-0.5 text-sm">
                <button type="button" onClick={() => setDraft(d => ({ ...d, mode: 'auto' }))} className={cn('rounded-full px-3 py-1.5', draft.mode === 'auto' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>Send by itself</button>
                <button type="button" onClick={() => setDraft(d => ({ ...d, mode: 'approve' }))} className={cn('rounded-full px-3 py-1.5', draft.mode === 'approve' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>Wait for my OK</button>
              </div>
              <p className="text-[11px] text-muted-foreground">{draft.mode === 'approve' ? 'Each day’s post waits until you press Approve on it; then it goes at its times.' : 'It goes at its times unless you hold the day.'}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button onClick={() => draft.enabled ? save(draft) : setConfirmOn(true)} disabled={saving || (!dirty && schedule.enabled) || !draft.days.length || !going.length}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}{draft.enabled ? 'Save changes' : 'Save and switch on'}
            </Button>
            {dirty && <Button variant="ghost" onClick={() => setDraft(schedule)} disabled={saving}>Discard</Button>}
            {!schedule.enabled && dirty && <Button variant="outline" onClick={() => save({ ...draft, enabled: false })} disabled={saving}>Save, keep it off</Button>}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {schedule.lastTick ? `Checked ${ago(schedule.lastTick)}` : 'Not checked yet'}{schedule.updatedBy ? ` · set by ${schedule.updatedBy === 'counter' ? 'the counter' : schedule.updatedBy}` : ''}
            </span>
          </div>
        </div>
      )}

      <AlertDialog open={confirmOn} onOpenChange={setConfirmOn}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send Investments by Taheri automatically?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>From now on, {daysLabel(draft.days) === 'Every day' ? 'every day' : `on ${daysLabel(draft.days)}`}, once the routine has filed the day’s post{draft.mode === 'approve' ? ' and you’ve approved it' : ''}:</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {going.map(t => <li key={t}><b>{draft.targets[t].at === 'arrival' ? 'As soon as it arrives' : clock(draft.targets[t].at)}</b> — {TARGETS[t].label.toLowerCase()} to {TARGETS[t].to}</li>)}
                </ul>
                <p className="text-xs">Only that day’s post, each part once. A late post still goes until {clock(draft.lateUntil)}. Hold any day from its card.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOn(false); save({ ...draft, enabled: true }); }}>Switch it on</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** What the schedule will do with one part today, in a line. */
function autoLine(st: Status): { text: string; tone: 'muted' | 'ok' | 'warn' } | null {
  switch (st.kind) {
    case 'later': return { text: `Goes by itself at ${clock(hhmm(st.at))}`, tone: 'ok' };
    case 'due': return { text: 'Going out at the next check (within 5 minutes)', tone: 'ok' };
    case 'sending': return { text: 'Sending now…', tone: 'ok' };
    case 'held': return { text: 'Held — won’t go by itself today', tone: 'muted' };
    case 'needs-ok': return { text: 'Waiting for your OK', tone: 'warn' };
    case 'not-a-day': return { text: 'Not a posting day — send it by hand if you want', tone: 'muted' };
    case 'missing': return { text: `Won’t go by itself: there’s no ${st.what.replace(/^(the|a) /, '')}`, tone: 'warn' };
    case 'too-late': return { text: 'Its time passed — send it by hand', tone: 'warn' };
    case 'gave-up': return { text: `Failed 3 times: ${st.error}`, tone: 'warn' };
    default: return null; // sent, off, paused, another day
  }
}

// ── A day ──────────────────────────────────────────────────────────────────

function DayCard({ post: p, isToday, targets, schedule, now, onChanged }: { post: Post; isToday: boolean; targets: Target[]; schedule: Schedule | null; now: KarachiNow; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(isToday);
  const [post, setPost] = useState(p.post);
  const [teaser, setTeaser] = useState(p.teaser);
  const [busy, setBusy] = useState<Target | 'all' | 'plan' | null>(null);
  const [confirm, setConfirm] = useState<{ targets: Target[]; force: boolean } | null>(null);
  useEffect(() => { setPost(p.post); setTeaser(p.teaser); }, [p.post, p.teaser]);

  const card = (kind: 'square' | 'story') => `/api/public/investments/${p.id}/${kind}?v=${encodeURIComponent(p.receivedAt)}`;
  const sentCount = targets.filter(t => p.sent[t]).length;
  const missing = (t: Target) => (t === 'teaser' && !teaser.trim()) || (t === 'instagram' && !p.cards.includes('story')) || ((t === 'group' || t === 'channel') && !post.trim());
  // Send all: everything not yet sent that has what it needs, in the schedule's order.
  const unsent = targets.filter(t => !p.sent[t] && !missing(t));
  const scheduled = isToday && !!schedule?.enabled;

  /** One part through the Send route; true when it went. */
  const sendOne = async (target: Target, force: boolean): Promise<boolean> => {
    const res = await fetch(`/api/investments/${p.id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ target, force, ...(post !== p.post ? { post } : {}), ...(teaser !== p.teaser ? { teaser } : {}) }),
    });
    const d = await res.json().catch(() => ({}));
    // Already sent (the schedule got there first): that part is done, not an error.
    if (res.ok || (res.status === 409 && !force)) return true;
    const dg = diagnose(target === 'instagram' ? 'instagram' : 'whatsapp', { status: res.status, message: d.error || `${res.status}` });
    toast({ title: `${TARGETS[target].label} to ${TARGETS[target].to}: ${dg.title}`, description: dg.fix, variant: 'destructive' });
    return false;
  };
  const send = async (list: Target[], force: boolean) => {
    setBusy(list.length > 1 ? 'all' : list[0]);
    const done: Target[] = [];
    try {
      // One after another, the group first: if one fails the rest still go, and each says how it went.
      for (const t of list) if (await sendOne(t, force)) done.push(t);
      if (done.length) toast({ title: done.length === list.length ? (list.length > 1 ? 'All sent' : 'Sent') : `${done.length} of ${list.length} sent`, description: done.map(t => `${TARGETS[t].label} → ${TARGETS[t].to}`).join(' · ') });
      onChanged();
    } finally {
      setBusy(null);
    }
  };
  const plan = async (change: { hold?: boolean; approve?: boolean; retry?: Target }) => {
    setBusy('plan');
    try {
      const res = await fetch(`/api/investments/${p.id}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(change) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `${res.status}`);
      onChanged();
    } catch (e) {
      toast({ title: 'Could not change the plan', description: e instanceof Error ? e.message : '', variant: 'destructive' });
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
          {p.hold && <span className="ml-2 text-xs rounded-full bg-muted px-2 py-0.5">Held</span>}
          <span className="block text-xs text-muted-foreground truncate">{p.post.split('\n').find(l => l.trim())?.replace(/[*_]/g, '')}</span>
        </span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{sentCount}/{targets.length} sent</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t p-4 grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
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
            {(post !== p.post || teaser !== p.teaser) && <p className="text-xs text-amber-600">You’ve changed the words — what you send now is your version, and it’s saved when it goes.{scheduled ? ' The schedule sends the saved words, so send by hand to use these.' : ''}</p>}
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

            {/* Today, on a schedule: hold it, or give it the OK the schedule waits for. */}
            {scheduled && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> On the schedule</p>
                <div className="flex flex-wrap gap-1.5">
                  {schedule!.mode === 'approve' && !p.approved && !p.hold && (
                    <Button size="sm" className="h-8" disabled={!!busy} onClick={() => plan({ approve: true })}><ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Approve today</Button>
                  )}
                  {schedule!.mode === 'approve' && p.approved && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Approved {time(p.approved.at)}</span>}
                  {p.hold
                    ? <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => plan({ hold: false })}><Play className="h-3.5 w-3.5 mr-1.5" /> Let it send</Button>
                    : <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => plan({ hold: true })}><Pause className="h-3.5 w-3.5 mr-1.5" /> Hold today</Button>}
                </div>
              </div>
            )}

            {unsent.length > 1 && (
              <Button className="w-full" disabled={!!busy} onClick={() => setConfirm({ targets: unsent, force: false })}>
                {busy === 'all' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <SendHorizonal className="h-4 w-4 mr-1.5" />} Send all {unsent.length === 3 ? 'three' : unsent.length === 4 ? 'four' : unsent.length === 2 ? 'two' : unsent.length}
              </Button>
            )}

            <div className="space-y-2">
              {targets.map(t => {
                const s = p.sent[t];
                const st = schedule ? statusOf(schedule, p, t, now) : null;
                const line = scheduled && st ? autoLine(st) : null;
                return (
                  <div key={t} className="rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      {TARGETS[t].icon}<span className="flex-1 font-medium">{TARGETS[t].label}</span>
                      {s ? <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check className="h-3.5 w-3.5" /> {time(s.at)}{s.by === 'schedule' ? ' · auto' : ''}</span> : null}
                    </div>
                    <p className="text-[11px] text-muted-foreground">to {TARGETS[t].to}</p>
                    {line && (
                      <p className={cn('mt-1 text-[11px] flex items-center gap-1', line.tone === 'ok' ? 'text-emerald-600' : line.tone === 'warn' ? 'text-amber-600' : 'text-muted-foreground')}>
                        <CalendarClock className="h-3 w-3 shrink-0" /> {line.text}
                        {st?.kind === 'gave-up' && <button type="button" className="ml-1 text-primary inline-flex items-center gap-0.5" disabled={!!busy} onClick={() => plan({ retry: t })}><RotateCw className="h-3 w-3" /> Try again</button>}
                      </p>
                    )}
                    <Button size="sm" variant={s ? 'ghost' : 'default'} className="mt-1.5 w-full h-8" disabled={!!busy || missing(t)}
                      onClick={() => setConfirm({ targets: [t], force: !!s })}>
                      {busy === t ? <Loader2 className="h-4 w-4 animate-spin" /> : s ? 'Send again…' : <><Send className="h-3.5 w-3.5 mr-1.5" /> Send now</>}
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
            <AlertDialogTitle>{confirm?.force ? 'Send it again?' : confirm && confirm.targets.length > 1 ? `Send all ${confirm.targets.length} now?` : 'Send it now?'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {confirm && confirm.targets.length > 1 ? (<>
                  <p>{longDate(p.date)}, one after another:</p>
                  <ul className="list-disc pl-5 space-y-0.5">{confirm.targets.map(t => <li key={t}>{TARGETS[t].label} → {TARGETS[t].to}</li>)}</ul>
                  <p className="text-xs">None of it can be unsent from here.</p>
                </>) : confirm && (
                  <p>{`${TARGETS[confirm.targets[0]].label} for ${longDate(p.date)} goes to ${TARGETS[confirm.targets[0]].to}${confirm.force ? ' a second time — everyone will see it twice' : ''}. It can’t be unsent from here.`}</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = confirm!; setConfirm(null); send(c.targets, c.force); }}>{confirm?.force ? 'Send again' : confirm && confirm.targets.length > 1 ? 'Send all' : 'Send'}</AlertDialogAction>
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
