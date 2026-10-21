"use client";

/**
 * Settings → Connect an AI (docs/features/ai-keys.md). The owner, 2026-10-21: "an API key thing so that I can
 * use other AI to go into the ERP and make posts for me and stuff."
 *
 * Make a key (a name, what it may do, an optional expiry), see it once with the setup for Claude, ChatGPT,
 * Gemini and Cursor, and keep an eye on every key: when it was last used, how often, revoke. The server keeps
 * only the key's hash (lib/agent/keys.ts); everything an AI does is in Settings → Activity under its name.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, Copy, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { PageShell } from '@/components/shared/page-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { authedFetch } from '@/lib/voice/authed-fetch';
import { STORE_CONFIG } from '@/lib/store-config';
import { tonePill } from '@/lib/tones';
import { cn } from '@/lib/utils';
import type { Scope } from '@/lib/agent/scopes';

interface ScopeRow { id: Scope; label: string; detail: string; byDefault: boolean }
interface KeyRow {
  id: string; label: string; scopes: Scope[]; tail: string; createdBy: string; createdAt: string;
  expiresAt: string | null; lastUsedAt: string | null; calls: number; connectors: number;
}

const EXPIRY = [
  { id: 'never', label: 'Never', days: 0 },
  { id: '30', label: '30 days', days: 30 },
  { id: '90', label: '90 days', days: 90 },
  { id: '365', label: 'A year', days: 365 },
] as const;

const AIS = ['claude', 'chatgpt', 'gemini', 'cursor'] as const;
type Ai = (typeof AIS)[number];
const AI_LABEL: Record<Ai, string> = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini CLI', cursor: 'Cursor' };

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await authedFetch(path, { ...init, ...(init.json !== undefined ? { body: JSON.stringify(init.json), headers: { 'Content-Type': 'application/json' } } : {}) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `The server answered ${res.status}.`);
  return d as T;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shop';

function CopyBlock({ text, label }: { text: string; label?: string }) {
  const { toast } = useToast();
  const [done, setDone] = useState(false);
  const copy = () => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); toast({ title: 'Copied' }); });
  return (
    <div className="space-y-1">
      {label && <p className="text-ios-foot text-muted-foreground">{label}</p>}
      <div className="flex items-start gap-2 rounded-xl bg-muted p-3">
        <pre className="flex-1 min-w-0 whitespace-pre-wrap break-all text-[12px] leading-snug font-mono">{text}</pre>
        <button type="button" onClick={copy} title="Copy" className="h-8 w-8 min-h-0 shrink-0 rounded-full flex items-center justify-center hover:bg-background">
          {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Setup({ base, keyText, scopes }: { base: string; keyText: string; scopes: Scope[] }) {
  const [ai, setAi] = useState<Ai>('claude');
  const name = `${slug(STORE_CONFIG.name)}-erp`;
  const mcp = `${base}/api/agent/mcp`;
  const openapi = `${base}/api/agent/openapi.json?scopes=${scopes.join(',')}`;
  const json = (k: 'url' | 'httpUrl') => JSON.stringify({ mcpServers: { [name]: { [k]: mcp, headers: { Authorization: `Bearer ${keyText}` } } } }, null, 2);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {AIS.map(a => (
          <button key={a} type="button" role="tab" aria-selected={ai === a} onClick={() => setAi(a)}
            className={cn('rounded-full px-3.5 py-1.5 text-sm font-medium min-h-0', ai === a ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
            {AI_LABEL[a]}
          </button>
        ))}
      </div>
      {ai === 'claude' && (
        <div className="space-y-3 text-sm">
          <p><b>claude.ai or the Claude app:</b> Settings → Connectors → Add custom connector. Paste this address, press Connect, and paste the key on the ERP’s page that opens.</p>
          <CopyBlock text={mcp} />
          <p><b>Claude Code</b> (a terminal):</p>
          <CopyBlock text={`claude mcp add --transport http ${name} ${mcp} --header "Authorization: Bearer ${keyText}"`} />
        </div>
      )}
      {ai === 'chatgpt' && (
        <div className="space-y-3 text-sm">
          <p><b>A connector</b> (ChatGPT → Settings → Apps &amp; Connectors → Advanced → Developer mode, then Create): the MCP server address below, authentication OAuth; paste the key on the ERP’s page that opens.</p>
          <CopyBlock text={mcp} />
          <p><b>A custom GPT:</b> Configure → Actions → Create new action → Import from URL, then Authentication → API key → Bearer, and paste the key. In its instructions: “Call get_guide first.”</p>
          <CopyBlock text={openapi} />
          <CopyBlock label="The key, for the GPT’s API key box" text={keyText} />
        </div>
      )}
      {ai === 'gemini' && (
        <div className="space-y-3 text-sm">
          <p>Add this to <code>~/.gemini/settings.json</code> (merge it with what is there):</p>
          <CopyBlock text={json('httpUrl')} />
        </div>
      )}
      {ai === 'cursor' && (
        <div className="space-y-3 text-sm">
          <p>Add this to <code>~/.cursor/mcp.json</code> (or the project’s <code>.cursor/mcp.json</code>):</p>
          <CopyBlock text={json('url')} />
        </div>
      )}
      <p className="text-ios-foot text-muted-foreground">Then ask it, for example: “Make a story and a post of our newest emerald ring and queue it for the community.” It waits in Posts for your OK.</p>
    </div>
  );
}

export default function ConnectAiPage() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [scopeRows, setScopeRows] = useState<ScopeRow[]>([]);
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState<Set<Scope>>(new Set());
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]['id']>('never');
  const [making, setMaking] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; info: KeyRow } | null>(null);
  const [revoking, setRevoking] = useState<KeyRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const base = useMemo(() => (STORE_CONFIG.appUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, ''), []);

  const load = useCallback(async () => {
    try {
      const d = await call<{ keys: KeyRow[]; scopes: ScopeRow[] }>('/api/agent/keys');
      setKeys(d.keys);
      setScopeRows(d.scopes);
      setPicked(prev => (prev.size ? prev : new Set(d.scopes.filter(s => s.byDefault).map(s => s.id))));
      setProblem(null);
    } catch (e) { setKeys([]); setProblem(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = (id: Scope, on: boolean) => setPicked(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

  const make = async () => {
    setMaking(true);
    try {
      const days = EXPIRY.find(e => e.id === expiry)!.days;
      const made = await call<{ key: string; info: KeyRow }>('/api/agent/keys', { method: 'POST', json: {
        label: label.trim() || 'AI', scopes: scopeRows.map(s => s.id).filter(id => picked.has(id)),
        expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
      } });
      setFresh(made);
      setLabel('');
      load();
    } catch (e) {
      toast({ title: 'Couldn’t make a key', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setMaking(false); }
  };

  const revoke = async (k: KeyRow) => {
    try {
      await call(`/api/agent/keys?id=${encodeURIComponent(k.id)}`, { method: 'DELETE' });
      if (fresh?.info.id === k.id) setFresh(null);
      toast({ title: `${k.label} can’t get in any more` });
      load();
    } catch (e) { toast({ title: 'Couldn’t revoke it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };

  const label_ = (id: Scope) => scopeRows.find(s => s.id === id)?.label ?? id;
  const expired = (k: KeyRow) => !!k.expiresAt && Date.parse(k.expiresAt) <= Date.now();

  return (
    <PageShell subtitle="Let ChatGPT, Claude, Gemini or Cursor work in the ERP: make posts for your OK, read the books, and only what you allow." width="narrow">
      <div className="space-y-4">
        {fresh && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> {fresh.info.label}’s key</CardTitle>
              <CardDescription>Shown only now — copy it into the AI. The ERP keeps only a fingerprint of it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CopyBlock text={fresh.key} />
              <Setup base={base} keyText={fresh.key} scopes={fresh.info.scopes} />
              <Button variant="secondary" onClick={() => setFresh(null)}>Done</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5" /> Make a key</CardTitle>
            <CardDescription>One key for each AI, so you can see what each did and stop one without the others.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="ai-label" className="text-sm font-medium">Name it</label>
              <Input id="ai-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="ChatGPT" maxLength={60} />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">It may</p>
              {scopeRows.map(s => (
                <label key={s.id} className="flex items-start gap-3 rounded-xl bg-muted/60 p-3 cursor-pointer">
                  <Checkbox className="mt-0.5" checked={picked.has(s.id)} onCheckedChange={v => toggle(s.id, v === true)} />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-ios-foot text-muted-foreground">{s.detail}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Stops working</p>
              <div className="flex flex-wrap gap-1.5">
                {EXPIRY.map(e => (
                  <button key={e.id} type="button" onClick={() => setExpiry(e.id)}
                    className={cn('rounded-full px-3.5 py-1.5 text-sm min-h-0', expiry === e.id ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                    {e.id === 'never' ? 'When you revoke it' : `In ${e.label.toLowerCase()}`}
                  </button>
                ))}
              </div>
            </div>
            <Button onClick={make} disabled={making || !picked.size}>
              {making ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1.5" />} Make the key
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Keys</CardTitle>
            <CardDescription>What each AI did is in Settings → Activity, under its name. Posts it queues wait in Posts for your OK.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {problem && <p className="text-sm text-destructive">{problem}</p>}
            {keys === null && <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
            {keys?.length === 0 && !problem && <p className="text-sm text-muted-foreground">No keys yet.</p>}
            {keys?.map(k => (
              <div key={k.id} className="flex items-start gap-3 rounded-xl bg-muted/60 p-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium">{k.label} <span className="text-muted-foreground font-normal">··{k.tail}</span></p>
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map(s => <span key={s} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', tonePill(s.startsWith('write') || s === 'posts:publish' ? 'owed' : 'house'))}>{label_(s)}</span>)}
                    {expired(k) && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', tonePill('late'))}>Expired</span>}
                  </div>
                  <p className="text-ios-foot text-muted-foreground">
                    Made {when(k.createdAt)}{k.expiresAt && !expired(k) ? ` · until ${new Date(k.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                    {' · '}{k.lastUsedAt ? `used ${when(k.lastUsedAt)} · ${k.calls} call${k.calls === 1 ? '' : 's'}` : 'not used yet'}
                    {k.connectors ? ` · ${k.connectors} connector${k.connectors === 1 ? '' : 's'} signed in` : ''}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="text-destructive shrink-0" onClick={() => setRevoking(k)}><Trash2 className="h-4 w-4 mr-1" /> Revoke</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {!fresh && (keys?.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>How to connect</CardTitle>
              <CardDescription>Put the key you were shown where it says &lt;key&gt;. Lost it? Make a new one and revoke the old.</CardDescription>
            </CardHeader>
            <CardContent><Setup base={base} keyText="<key>" scopes={[...new Set(keys!.flatMap(k => k.scopes))]} /></CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={!!revoking} onOpenChange={o => { if (!o) setRevoking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.label}’s key?</AlertDialogTitle>
            <AlertDialogDescription>It stops at once, with every connector signed in with it. What it already made stays.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (revoking) revoke(revoking); setRevoking(null); }}>Revoke</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
