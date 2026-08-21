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
import { Loader2, Hammer, LogOut, CheckCircle2, Flame, Clock, Scale, Banknote } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

interface Job {
  id: string; source: 'order' | 'manual';
  description: string; category?: string; metalType?: string; karat?: string;
  weightG?: number; quantity?: number;
  status: 'pending' | 'in-progress' | 'completed';
  assignedDate: string; ageDays: number; urgency: 'ok' | 'warning' | 'critical';
  notes?: string;
}
interface Payload {
  role: string;
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
  const { toast } = useToast();

  const load = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) { setLoading(false); return; }
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/karigar/me', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setData(await res.json());
    } catch { /* surfaced by the empty state */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(() => load());
    return () => unsub();
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
  const done = data.jobs.filter(j => j.status === 'completed');
  const critical = active.filter(j => j.urgency === 'critical');
  const late = active.filter(j => j.urgency === 'warning');
  const ontrack = active.filter(j => j.urgency === 'ok');

  const JobCard: React.FC<{ job: Job }> = ({ job }) => {
    const meta = [job.category, job.weightG ? `${job.weightG}g` : null, job.karat ? String(job.karat).toUpperCase() : null]
      .filter(Boolean).join(' · ');
    return (
      <div className={cn('flex items-start gap-3 py-3 border-b last:border-0', job.status === 'completed' && 'opacity-60')}>
        {busy === job.id
          ? <Loader2 className="h-5 w-5 mt-0.5 animate-spin text-muted-foreground flex-shrink-0" />
          : <Checkbox className="mt-1 h-5 w-5 flex-shrink-0" checked={job.status === 'completed'} onCheckedChange={() => toggle(job)} />}
        <div className="min-w-0 flex-1">
          <p className={cn('font-medium', job.status === 'completed' && 'line-through')}>{job.description}</p>
          {meta && <p className="text-sm text-muted-foreground mt-0.5">{meta}</p>}
          {job.notes && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{job.notes}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            Given {format(parseISO(job.assignedDate), 'dd MMM yyyy')} · {job.ageDays} day{job.ageDays === 1 ? '' : 's'} ago
          </p>
        </div>
        {job.status !== 'completed' && job.urgency !== 'ok' && (
          <Badge variant="outline" className={cn('flex-shrink-0',
            job.urgency === 'critical' ? 'text-destructive border-destructive/40 bg-destructive/10' : 'text-yellow-700 border-yellow-500/40 bg-yellow-500/10')}>
            {job.ageDays}d
          </Badge>
        )}
      </div>
    );
  };

  const Group: React.FC<{ title: string; jobs: Job[]; icon?: React.ReactNode; tone?: string }> = ({ title, jobs, icon, tone }) => {
    if (!jobs.length) return null;
    return (
      <div className="mt-4 first:mt-0">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <h2 className={cn('text-sm font-semibold', tone)}>{title}</h2>
          <Badge variant="secondary" className="text-[10px]">{jobs.length}</Badge>
        </div>
        <Card><CardContent className="py-1 px-4">{jobs.map(j => <JobCard key={j.id} job={j} />)}</CardContent></Card>
      </div>
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
        <Button variant="ghost" size="sm" onClick={() => firebaseSignOut(auth)}>
          <LogOut className="h-4 w-4 mr-1.5" />Sign out
        </Button>
      </header>

      <main className="p-4 max-w-2xl mx-auto pb-16">
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
                <Group title="Urgent" jobs={critical} icon={<Flame className="h-4 w-4 text-destructive" />} tone="text-destructive" />
                <Group title="Late" jobs={late} icon={<Clock className="h-4 w-4 text-yellow-600" />} tone="text-yellow-700" />
                <Group title="In hand" jobs={ontrack} />
              </>
            )}
            {done.length > 0 && <Group title="Completed" jobs={done} tone="text-muted-foreground" />}
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
