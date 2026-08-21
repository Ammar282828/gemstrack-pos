"use client";

/**
 * Karigar portal — the only page a karigar-role account can reach.
 * All data comes from /api/karigar/* (server-filtered); this page never touches
 * Firestore directly, and karigars have no direct database access at all.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { STORE_CONFIG } from '@/lib/store-config';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Hammer, LogOut, CheckCircle2, Flame, Clock, Scale, Banknote, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface Job {
  id: string; source: 'order' | 'manual';
  description: string; category?: string; metalType?: string; karat?: string;
  weightG?: number; quantity?: number;
  size?: string; referenceSku?: string; sampleGiven?: boolean; sampleImage?: string;
  orderId?: string;
  status: 'pending' | 'in-progress' | 'completed';
  assignedDate: string; ageDays: number; urgency: 'ok' | 'warning' | 'critical';
  notes?: string; specialNote?: string;
}
interface Payload {
  role: string;
  preview?: boolean;
  karigar: { id: string; name: string } | null;
  summary: { active: number; inProgress: number; late: number; critical: number; oldestDays: number };
  jobs: Job[];
  account: {
    goldGiven: number; goldReceived: number; goldNet: number; totalPaid: number;
    ledger: { date: string; description: string; goldOut: number; goldIn: number }[];
    payments: { date: string; amount: number; description: string }[];
  };
}

const fmt = (n: number) => Number(n || 0).toLocaleString('en-PK');

export default function MyWorkPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) { setLoading(false); return; }
    try {
      const token = await user.getIdToken();
      // ?preview=<karigarId> lets a signed-in owner inspect a karigar's portal.
      // Read from location rather than useSearchParams to avoid needing a
      // Suspense boundary around this client route.
      const preview = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('preview')
        : null;
      const url = preview ? `/api/karigar/me?karigarId=${encodeURIComponent(preview)}` : '/api/karigar/me';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { setData(await res.json()); setUpdatedAt(new Date()); }
    } catch { /* surfaced by the empty state */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(() => load());
    return () => unsub();
  }, [load]);

  // Karigars have no direct Firestore access, so there is no realtime listener
  // here (the owner-side store uses onSnapshot; this portal cannot). Re-fetch
  // whenever the page regains focus and poll gently while it is visible, so
  // edits made in the shop show up without the karigar knowing to refresh.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const id = setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(id);
    };
  }, [load]);

  const toggle = async (job: Job) => {
    const user = auth.currentUser;
    if (!user) return;
    setBusy(job.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/karigar/complete', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, completed: job.status !== 'completed' }),
      });
      if (!res.ok) throw new Error();
      await load();
      toast({ title: job.status !== 'completed' ? 'Marked done' : 'Reopened', description: job.description });
    } catch {
      toast({ title: 'Could not update', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (!data?.karigar) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <Card className="max-w-sm text-center">
          <CardContent className="py-10">
            <p className="font-medium">No work account found</p>
            <p className="text-sm text-muted-foreground mt-1">Ask the shop to add your Google address.</p>
            <Button variant="outline" className="mt-4" onClick={() => firebaseSignOut(auth)}>Sign out</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const active = data.jobs.filter(j => j.status !== 'completed');
  // Pieces from one order are usually made together, so show how many of the
  // karigar's own pieces sit on the same order.
  const perOrder = new Map<string, number>();
  for (const j of data.jobs) if (j.orderId) perOrder.set(j.orderId, (perOrder.get(j.orderId) || 0) + 1);
  const done = data.jobs.filter(j => j.status === 'completed');
  const byOrderThenAge = (a: Job, b: Job) =>
    (a.orderId || 'zzz').localeCompare(b.orderId || 'zzz') || b.ageDays - a.ageDays;
  const critical = active.filter(j => j.urgency === 'critical').sort(byOrderThenAge);
  const late = active.filter(j => j.urgency === 'warning').sort(byOrderThenAge);
  const ontrack = active.filter(j => j.urgency === 'ok').sort(byOrderThenAge);

  /**
   * One piece of work. The layout is deliberately tiered so it reads at a
   * glance on a phone: what to make (name) → what it must be (spec grid) →
   * how to make it (instructions) → when it came in (quiet footer).
   */
  const JobCard: React.FC<{ job: Job }> = ({ job }) => {
    const done = job.status === 'completed';
    // Size first — it is the spec most likely to be wrong if missed.
    const specs: { label: string; value: string; accent?: boolean }[] = [];
    if (job.size) specs.push({ label: 'Size', value: job.size, accent: true });
    if (job.weightG) specs.push({ label: 'Weight', value: `${job.weightG}g` });
    if (job.category) specs.push({ label: 'Type', value: job.category });
    if (job.karat) specs.push({ label: 'Karat', value: String(job.karat).toUpperCase() });
    if (job.referenceSku) specs.push({ label: 'Ref', value: job.referenceSku });
    if ((job.quantity ?? 1) > 1) specs.push({ label: 'Qty', value: String(job.quantity) });

    return (
      <Card className={cn(
        'transition-opacity',
        done && 'opacity-55',
        !done && job.urgency === 'critical' && 'border-destructive/40',
        !done && job.urgency === 'warning' && 'border-yellow-500/40',
      )}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {busy === job.id
              ? <Loader2 className="h-5 w-5 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
              : <Checkbox className="mt-0.5 h-5 w-5 flex-shrink-0" checked={done}
                  disabled={!!data.preview} onCheckedChange={() => toggle(job)} />}

            <div className="min-w-0 flex-1">
              {/* 1 — what to make */}
              <div className="flex items-start justify-between gap-2">
                <h3 className={cn('font-semibold text-base leading-snug break-words', done && 'line-through')}>
                  {job.description}
                </h3>
                {!done && job.urgency !== 'ok' && (
                  <Badge variant="outline" className={cn('flex-shrink-0 tabular-nums',
                    job.urgency === 'critical'
                      ? 'text-destructive border-destructive/40 bg-destructive/10'
                      : 'text-yellow-700 border-yellow-500/40 bg-yellow-500/10')}>
                    {job.ageDays}d
                  </Badge>
                )}
              </div>

              {/* 2 — what it must be */}
              {specs.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-3">
                  {specs.map(s => (
                    <div key={s.label} className={cn(
                      'rounded-md px-2.5 py-1.5 min-w-0',
                      s.accent ? 'bg-primary/10 ring-1 ring-primary/20' : 'bg-muted/60',
                    )}>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground leading-none">{s.label}</p>
                      <p className={cn('text-sm font-semibold truncate mt-1', s.accent && 'text-primary')}>{s.value}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                {job.orderId && (
                  <Badge variant="outline" className="text-xs font-mono">
                    {job.orderId}
                    {(perOrder.get(job.orderId) || 0) > 1 && (
                      <span className="ml-1 font-sans font-normal text-muted-foreground">
                        · {perOrder.get(job.orderId)} pieces
                      </span>
                    )}
                  </Badge>
                )}
                {job.source === 'manual' && (
                  <Badge variant="secondary" className="text-xs bg-violet-500/15 text-violet-700 dark:text-violet-300">Stock piece</Badge>
                )}
                {job.sampleGiven && <Badge variant="outline" className="text-xs">Sample provided</Badge>}
              </div>

              {job.sampleImage && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={job.sampleImage} alt="Sample" className="mt-3 rounded-md border max-h-56 object-contain bg-muted" />
              )}

              {/* 3 — how to make it */}
              {job.notes && (
                <div className="mt-3 rounded-md border-l-2 border-primary/50 bg-muted/40 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Instructions</p>
                  <p className="text-sm whitespace-pre-wrap mt-0.5">{job.notes}</p>
                </div>
              )}

              {job.specialNote && (
                <div className="mt-2 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/25 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-amber-800 dark:text-amber-300 font-semibold">Special note</p>
                  <p className="text-sm whitespace-pre-wrap mt-0.5 text-amber-900 dark:text-amber-100">{job.specialNote}</p>
                </div>
              )}

              {/* 4 — when it came in */}
              <p className="text-xs text-muted-foreground mt-3">
                Given {format(parseISO(job.assignedDate), 'dd MMM yyyy')} · {job.ageDays} day{job.ageDays === 1 ? '' : 's'} ago
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  const Group: React.FC<{ title: string; jobs: Job[]; icon?: React.ReactNode; tone?: string; hint?: string }> =
  ({ title, jobs, icon, tone, hint }) => {
    if (!jobs.length) return null;
    return (
      <section className="mt-6 first:mt-0">
        <div className="flex items-center gap-2 mb-2 px-0.5">
          {icon}
          <h2 className={cn('text-xs font-bold uppercase tracking-widest', tone)}>{title}</h2>
          <Badge variant="secondary" className="text-[10px]">{jobs.length}</Badge>
          {hint && <span className="text-[11px] text-muted-foreground ml-auto">{hint}</span>}
        </div>
        <div className="space-y-2">
          {jobs.map(j => <JobCard key={j.id} job={j} />)}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{STORE_CONFIG.name}</p>
          <h1 className="text-lg font-bold truncate flex items-center gap-2">
            <Hammer className="h-4 w-4 text-primary flex-shrink-0" />{data.karigar.name}
          </h1>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button variant="ghost" size="sm" title="Refresh"
            onClick={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </Button>
        {data.preview
          ? <Badge variant="secondary">Owner preview</Badge>
          : (
            <Button variant="ghost" size="sm" onClick={() => firebaseSignOut(auth)}>
              <LogOut className="h-4 w-4 mr-1.5" />Sign out
            </Button>
          )}
        </div>
      </header>

      {data.preview && (
        <div className="bg-primary/10 border-b px-4 py-2 text-xs text-center">
          Viewing exactly what <strong>{data.karigar.name}</strong> sees. Read-only —
          tick items off from the Workshop dashboard instead.
        </div>
      )}

      <main className="p-4 max-w-2xl mx-auto pb-16">
        {updatedAt && (
          <p className="text-[11px] text-muted-foreground text-center mb-3">
            Updated {format(updatedAt, 'h:mm a')} · refreshes automatically
          </p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">To do</p>
            <p className="text-2xl font-bold">{data.summary.active}</p>
          </CardContent></Card>
          <Card className={data.summary.late ? 'border-yellow-500/40' : ''}><CardContent className="p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Late</p>
            <p className={cn('text-2xl font-bold', data.summary.late && 'text-yellow-600')}>{data.summary.late}</p>
          </CardContent></Card>
          <Card className={data.summary.critical ? 'border-destructive/40' : ''}><CardContent className="p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Urgent</p>
            <p className={cn('text-2xl font-bold', data.summary.critical && 'text-destructive')}>{data.summary.critical}</p>
          </CardContent></Card>
        </div>

        <Tabs defaultValue="work" className="mt-4">
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="work">My Work</TabsTrigger>
            <TabsTrigger value="account">My Account</TabsTrigger>
          </TabsList>

          <TabsContent value="work" className="mt-4">
            {active.length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
                <p className="font-medium">Nothing pending</p>
                <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
              </CardContent></Card>
            ) : (
              <>
                <Group title="Urgent" jobs={critical} icon={<Flame className="h-4 w-4 text-destructive" />}
                  tone="text-destructive" hint="14+ days" />
                <Group title="Late" jobs={late} icon={<Clock className="h-4 w-4 text-yellow-600" />}
                  tone="text-yellow-700" hint="7–14 days" />
                <Group title="In hand" jobs={ontrack} hint="on track" />
              </>
            )}
            {done.length > 0 && (
              <Group title="Completed" jobs={done}
                icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} tone="text-muted-foreground" />
            )}
          </TabsContent>

          <TabsContent value="account" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Scale className="h-4 w-4 text-primary" />Gold</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Received</p>
                    <p className="text-lg font-bold">{data.account.goldGiven.toFixed(3)}g</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">Returned</p>
                    <p className="text-lg font-bold">{data.account.goldReceived.toFixed(3)}g</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">With you</p>
                    <p className={cn('text-lg font-bold', data.account.goldNet > 0 && 'text-destructive')}>{data.account.goldNet.toFixed(3)}g</p>
                  </div>
                </div>
                {data.account.ledger.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <div className="max-h-72 overflow-y-auto">
                      {data.account.ledger.map((l, i) => (
                        <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
                          <div className="min-w-0">
                            <span className="text-xs text-muted-foreground">{l.date ? format(parseISO(l.date), 'dd MMM yy') : ''}</span>
                            <span className="ml-2">{l.description}</span>
                          </div>
                          <span className={cn('font-semibold tabular-nums flex-shrink-0', l.goldOut ? 'text-destructive' : 'text-green-600')}>
                            {l.goldOut ? `↑ ${l.goldOut.toFixed(3)}g` : `↓ ${l.goldIn.toFixed(3)}g`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Banknote className="h-4 w-4 text-primary" />Payments received</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">PKR {fmt(data.account.totalPaid)}</p>
                <p className="text-xs text-muted-foreground">total paid to you</p>
                {data.account.payments.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <div className="max-h-72 overflow-y-auto">
                      {data.account.payments.map((p, i) => (
                        <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
                          <div className="min-w-0">
                            <span className="text-xs text-muted-foreground">{p.date ? format(parseISO(p.date), 'dd MMM yy') : ''}</span>
                            <span className="ml-2">{p.description}</span>
                          </div>
                          <span className="font-semibold tabular-nums flex-shrink-0">{fmt(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
