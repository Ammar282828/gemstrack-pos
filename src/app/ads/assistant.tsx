'use client';

/**
 * The Ads helper: a floating button on every Ads page (only there — it is
 * mounted by src/app/ads/layout.tsx) that opens a chat about this house's ad
 * account. Answers come from Gemini Pro with the account's numbers in front of it
 * (src/lib/ads/assistant.ts), for the range the page is showing — the pickers
 * move together. The conversation is kept on this device.
 *
 * Sits just above the voice button; on a phone the chat is a bottom sheet, on a
 * computer a panel in the corner.
 */

import React, { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, X, Send, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RANGES, rangeLabel } from '@/lib/ads/shape';
import { api, useRange } from './ads-kit';

interface Msg { role: 'user' | 'assistant'; text: string; error?: boolean }

const STORE_KEY = 'taheri_ads_chat';
const PAGE_NAME: Record<string, string> = {
  '/ads': 'Ads → Overview', '/ads/campaigns': 'Ads → Campaigns', '/ads/new': 'Ads → New ad',
  '/ads/audiences': 'Ads → Audiences', '/ads/rules': 'Ads → Rules', '/ads/setup': 'Ads → Setup', '/ads/studio': 'Ads → Studio',
};
const SUGGESTIONS = [
  'How did the ads do this week?',
  'Which ad should I pause, and which deserves more budget?',
  'Why has my cost per chat changed?',
  'Who is responding best — age, gender, city?',
  'What should my next ad be?',
];

// ── A little markdown: headings, lists, tables, bold, italics, code ────────

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${key}b${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={`${key}c${i++}`} className="rounded bg-background/70 px-1 text-[0.85em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={`${key}i${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { blocks.push(<p key={i} className="font-semibold mt-1">{inline(h[1], `h${i}`)}</p>); continue; }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      blocks.push(
        <div key={i} className="overflow-x-auto -mx-1"><table className="text-xs my-1 min-w-full">
          <tbody>{rows.map((r, ri) => <tr key={ri} className={ri === 0 ? 'font-semibold' : 'border-t border-border/60'}>{r.map((c, ci) => <td key={ci} className="px-1 py-0.5 align-top">{inline(c, `t${i}${ri}${ci}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++; }
      i--;
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={i} className={cn('pl-5 space-y-0.5', ordered ? 'list-decimal' : 'list-disc')}>{items.map((it, n) => <li key={n}>{inline(it, `l${i}${n}`)}</li>)}</List>);
      continue;
    }
    blocks.push(<p key={i}>{inline(line, `p${i}`)}</p>);
  }
  return <div className="space-y-1.5">{blocks}</div>;
}

/** "gemini-3.1-pro-preview" → "Gemini 3.1 Pro". */
const modelName = (m: string) => m.replace(/-preview$/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// ── The helper ─────────────────────────────────────────────────────────────

export function AdsAssistant() {
  const pathname = usePathname() || '/ads';
  const [range, setRange] = useRange();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [model, setModel] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as Msg[]; if (Array.isArray(saved)) setMsgs(saved.slice(-30)); } catch { /* first time */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(msgs.filter(m => !m.error).slice(-30))); } catch { /* private mode */ }
  }, [msgs]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy, open]);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs.filter(m => !m.error), { role: 'user', text: q }];
    setMsgs(next); setDraft(''); setBusy(true);
    if (input.current) input.current.style.height = 'auto';
    try {
      const d = await api<{ reply: string; model: string }>('/api/ads/assistant', {
        body: { messages: next.map(({ role, text }) => ({ role, text })), range, page: PAGE_NAME[pathname] ?? 'Ads' },
      });
      setModel(d.model);
      setMsgs(m => [...m, { role: 'assistant', text: d.reply }]);
    } catch (e) {
      setMsgs(m => [...m, { role: 'assistant', text: e instanceof Error ? e.message : String(e), error: true }]);
    } finally { setBusy(false); }
  };
  const retry = () => {
    const lastUser = [...msgs].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    setMsgs(m => m.filter(x => !x.error).slice(0, -1));
    ask(lastUser.text);
  };

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Ask the Ads helper"
          className="glass-fab fixed right-4 bottom-[9.25rem] md:bottom-[5.5rem] z-40 flex h-12 w-12 min-h-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 transition-transform">
          <Sparkles className="h-5 w-5" />
          {busy && <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-warning animate-pulse" />}
        </button>
      )}
      {open && (
        <div className="glass glass-window glass-full fixed z-50 inset-x-0 bottom-0 h-[88dvh] rounded-t-2xl md:inset-x-auto md:right-4 md:bottom-4 md:h-[min(680px,calc(100dvh-2rem))] md:w-[420px] md:rounded-2xl border bg-background shadow-2xl flex flex-col overflow-hidden">
          <header className="flex items-center gap-2 border-b px-3 py-2.5">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">Ads helper</p>
              <p className="text-[11px] text-muted-foreground truncate">Knows the ad account · {model ? modelName(model) : 'Gemini Pro'}</p>
            </div>
            <select value={range} onChange={e => setRange(e.target.value as typeof range)} className="h-8 rounded-md border bg-background px-1.5 text-xs" aria-label="Range">
              {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            {msgs.length > 0 && <button type="button" onClick={() => setMsgs([])} className="rounded-md p-1.5 min-h-0 text-muted-foreground hover:text-foreground" aria-label="New conversation" title="New conversation"><RotateCcw className="h-4 w-4" /></button>}
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 min-h-0 text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-4 w-4" /></button>
          </header>

          <div ref={scroller} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
            {!msgs.length && (
              <div className="space-y-3">
                <p className="text-muted-foreground">Ask anything about the ads — what’s working, what to pause, where to spend, who’s responding. I look at {rangeLabel(range).toLowerCase()} and can pull any other range or split.</p>
                <div className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map(s => <button key={s} type="button" onClick={() => ask(s)} className="text-left rounded-lg border px-3 py-2 text-sm hover:border-primary/60 min-h-0">{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[88%] rounded-2xl px-3 py-2 leading-relaxed',
                  m.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-md whitespace-pre-wrap' : m.error ? 'bg-destructive/10 text-destructive rounded-bl-md' : 'bg-muted rounded-bl-md')}>
                  {m.role === 'user' ? m.text : m.error ? (
                    <span className="flex gap-2"><TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" /><span>{m.text} <button type="button" onClick={retry} className="underline min-h-0">Try again</button></span></span>
                  ) : <Markdown text={m.text} />}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {elapsed < 6 ? 'Looking at the account…' : elapsed < 25 ? `Thinking it through… ${elapsed}s` : `Pulling more numbers… ${elapsed}s`}
              </div></div>
            )}
          </div>

          <form onSubmit={e => { e.preventDefault(); ask(draft); }} className="border-t p-2 flex items-end gap-2">
            <textarea ref={input} value={draft} onChange={e => setDraft(e.target.value)} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }}
              placeholder="Ask about the ads…" aria-label="Question"
              className="flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-base md:text-sm max-h-32 min-h-[2.5rem] focus:outline-none focus:ring-2 focus:ring-ring"
              onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(128, t.scrollHeight)}px`; }} />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send"
              className="h-10 w-10 min-h-0 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
