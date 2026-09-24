'use client';

/**
 * The checks strip at the top of Post a Piece: every connection the page
 * depends on, tested live, and for anything not working, what to do — in a
 * sentence, with the button or command that does it.
 *
 * Collapsed when all is well (one green line); open by itself when something
 * has failed, so a broken WhatsApp line is seen before a post is attempted,
 * not after.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Loader2, RefreshCw, ChevronDown, ExternalLink, Copy, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Action, DiagnoseContext } from '@/lib/social/diagnose';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'off';
export interface Check { id: string; group: 'Website' | 'WhatsApp' | 'Instagram' | 'AI'; label: string; status: CheckStatus; detail: string; fix?: string; action?: Action }
export interface HealthReport {
  at: string;
  checks: Check[];
  errors: { at: string; where: string; message: string; title: string; fix: string }[];
  summary: { ok: number; warn: number; fail: number };
  context: DiagnoseContext;
}

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

/** Runs the checks on load; `refresh(true)` re-runs the AI check too. */
export function useHealth() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const refresh = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/website/post/health${fresh ? '?fresh=1' : ''}`, { headers: await authHeaders(), cache: 'no-store' });
      if (!res.ok) throw new Error(`The checks could not run (${res.status}).`);
      setReport(await res.json());
      setFailed(null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The checks could not run.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { report, loading, failed, refresh };
}

/** Record a failure the page saw itself, so the panel's history has it. Never throws. */
export async function reportError(where: string, message: string, status?: number) {
  try {
    await fetch('/api/website/post/health', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ where, message, status }) });
  } catch { /* nothing to do about it */ }
}

const ICON: Record<CheckStatus, React.ReactNode> = {
  ok: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  fail: <XCircle className="h-4 w-4 text-destructive" />,
  off: <MinusCircle className="h-4 w-4 text-muted-foreground" />,
};

export function ActionButton({ action }: { action: Action }) {
  const { toast } = useToast();
  if (action.href) {
    return <a href={action.href} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-primary hover:bg-primary/5">{action.label} <ExternalLink className="h-3 w-3" /></a>;
  }
  if (action.command) {
    return (
      <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(action.command!); toast({ title: 'Command copied', description: 'Run it in a terminal signed in to Google Cloud.' }); } catch { /* shown below */ } }}
        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs text-primary hover:bg-primary/5" title={action.command}>
        <Copy className="h-3 w-3" /> {action.label}
      </button>
    );
  }
  return null;
}

export function HealthPanel({ health }: { health: ReturnType<typeof useHealth> }) {
  const { report, loading, failed, refresh } = health;
  const problems = report?.checks.filter(c => c.status === 'fail' || c.status === 'warn') ?? [];
  const hasFail = problems.some(c => c.status === 'fail');
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Open by itself the first time something is found broken.
  useEffect(() => { if (hasFail) setOpen(true); }, [hasFail]);

  const tone = failed || hasFail ? 'border-destructive/40 bg-destructive/5' : problems.length ? 'border-amber-500/40 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5';
  const headline = loading && !report
    ? 'Checking the website, WhatsApp, Instagram and AI…'
    : failed
      ? failed
      : problems.length
        ? `${problems.length} thing${problems.length === 1 ? '' : 's'} need${problems.length === 1 ? 's' : ''} attention: ${problems.map(p => p.label).join(' · ')}`
        : 'Everything is connected and working';
  const groups = ['Website', 'WhatsApp', 'Instagram', 'AI'] as const;

  return (
    <div className={cn('rounded-lg border text-sm', tone)}>
      <div className="flex items-center gap-2 px-3 py-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : failed || hasFail ? ICON.fail : problems.length ? ICON.warn : ICON.ok}
        <button type="button" onClick={() => setOpen(o => !o)} className="flex-1 min-w-0 text-left truncate font-medium">{headline}</button>
        {report && <span className="hidden sm:inline text-xs text-muted-foreground whitespace-nowrap">checked {new Date(report.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={loading} onClick={() => refresh(true)} title="Check again"><RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /></Button>
        <button type="button" onClick={() => setOpen(o => !o)} aria-label="Details"><ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /></button>
      </div>

      {open && report && (
        <div className="border-t px-3 py-3 space-y-4">
          {groups.map(g => {
            const rows = report.checks.filter(c => c.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="space-y-1.5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{g}</p>
                {rows.map(c => (
                  <div key={c.id} className="flex items-start gap-2">
                    <span className="mt-0.5">{ICON[c.status]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-tight">{c.label}</p>
                      <p className="text-xs text-muted-foreground break-words">{c.detail}</p>
                      {c.fix && c.status !== 'ok' && (
                        <div className="mt-1 rounded-md bg-background/70 border px-2.5 py-2 space-y-1.5">
                          <p className="text-xs"><span className="font-semibold">Fix: </span>{c.fix}</p>
                          {c.action && <ActionButton action={c.action} />}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          <div className="border-t pt-3">
            <button type="button" onClick={() => setShowHistory(h => !h)} className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <History className="h-3.5 w-3.5" /> {report.errors.length ? `${report.errors.length} problem${report.errors.length === 1 ? '' : 's'} in the last 24 hours` : 'No problems in the last 24 hours'}
            </button>
            {showHistory && report.errors.length > 0 && (
              <ul className="mt-2 space-y-2">
                {report.errors.map((e, i) => (
                  <li key={i} className="text-xs">
                    <span className="text-muted-foreground tabular-nums">{new Date(e.at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {e.where}</span>
                    <span className="block font-medium">{e.title}</span>
                    <span className="block text-muted-foreground">{e.fix}</span>
                    <span className="block text-muted-foreground/70 break-words">“{e.message.slice(0, 180)}”</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
