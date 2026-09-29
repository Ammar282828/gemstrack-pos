'use client';

/**
 * Post it: the ad the maker made, sent the ordinary way too — the 9:16 version to the Instagram
 * story (by the house's connection, or the share sheet), the square to the WhatsApp groups and the
 * channel (Post a Piece's route, destination keys only), and the square into a website collection
 * (Add Photos' relay). WhatsApp and the website only ever get 1:1 (owner, 2026-09-25).
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, CheckCircle2, XCircle, Instagram, MessageCircle, Globe, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_LINKS } from '@/lib/store-config';
import { authHeaders } from '../ads-kit';
import { SITE_LABEL } from './studio-kit';

interface Where { key: string; label: string }
interface Options { story: 'api' | 'share' | null; wa: Where[]; site: { folder: string; label: string }[] }
type Result = { key: string; ok: boolean; note?: string };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(await authHeaders()), ...(init?.headers ?? {}) }, cache: 'no-store' });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((d as { error?: string }).error || `Failed (${res.status})`);
  return d as T;
}

async function loadOptions(): Promise<Options> {
  const [ig, wa, site] = await Promise.all([
    json<{ configured?: boolean; connected?: boolean }>('/api/instagram/status').catch(() => null),
    json<{ community: unknown; channel: { name: string } | null; groups: { key: string; label: string }[] }>('/api/website/post').catch(() => null),
    STORE_LINKS.website ? json<{ collections: { folder: string; category: string; collection: string }[]; configured: boolean }>('/api/website/photos').catch(() => null) : Promise.resolve(null),
  ]);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';
  return {
    story: ig?.connected ? 'api' : canShare ? 'share' : null,
    wa: wa?.community ? [...wa.groups.map(g => ({ key: g.key, label: g.label })), ...(wa.channel ? [{ key: 'channel', label: 'Channel' }] : [])] : [],
    site: site?.configured ? site.collections.map(c => ({ folder: c.folder, label: c.category === c.collection ? c.collection : `${c.category} · ${c.collection}` })) : [],
  };
}

export function PostIt({ ready, render, caption: initial, name }: {
  ready: boolean;
  /** The design drawn at a size: 'square' for WhatsApp and the website, 'story' for the story. */
  render: (f: 'square' | 'story') => Promise<Blob>;
  caption: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Options | null>(null);
  const [story, setStory] = useState(false);
  const [wa, setWa] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [caption, setCaption] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  // The share sheet needs a fresh tap, so a story without the house's Instagram connection waits on its own button.
  const [shareFile, setShareFile] = useState<File | null>(null);
  useEffect(() => { if (open && !opts) loadOptions().then(o => { setOpts(o); setStory(!!o.story); setWa(o.wa.slice(0, 1).map(w => w.key)); }).catch(() => setOpts({ story: null, wa: [], site: [] })); }, [open, opts]);
  useEffect(() => { setCaption(initial); }, [initial]);

  const post = async () => {
    setBusy(true); setResults([]); setShareFile(null);
    const out: Result[] = [];
    const file = (b: Blob, suffix: string) => new File([b], `${(name || 'ad').replace(/[^\w-]+/g, '-').slice(0, 60)}${suffix}.jpg`, { type: 'image/jpeg' });
    try {
      const square = wa.length || folder ? await render('square') : null;
      if (story && opts?.story) {
        try {
          const f = file(await render('story'), '-story');
          if (opts.story === 'api') {
            const form = new FormData(); form.append('file', f);
            await json('/api/instagram/story', { method: 'POST', body: form });
            out.push({ key: 'story', ok: true });
          } else setShareFile(f);
        } catch (e) { out.push({ key: 'story', ok: false, note: e instanceof Error ? e.message : String(e) }); }
      }
      if (square && wa.length) {
        const form = new FormData();
        form.append('file', file(square, ''));
        form.append('caption', caption.trim());
        form.append('targets', wa.join(','));
        try {
          const d = await json<{ results: { key: string; ok: boolean; error?: string }[] }>('/api/website/post', { method: 'POST', body: form });
          d.results.forEach(r => out.push({ key: r.key, ok: r.ok, note: r.error }));
        } catch (e) { wa.forEach(k => out.push({ key: k, ok: false, note: e instanceof Error ? e.message : String(e) })); }
      }
      if (square && folder) {
        const form = new FormData();
        form.append('file', file(square, ''));
        form.append('folder', folder);
        if (name) form.append('name', name.slice(0, 80));
        try { await json('/api/website/photos', { method: 'POST', body: form }); out.push({ key: 'site', ok: true }); }
        catch (e) { out.push({ key: 'site', ok: false, note: e instanceof Error ? e.message : String(e) }); }
      }
    } finally { setResults(out); setBusy(false); }
  };

  const label = (k: string) => (k === 'story' ? 'Story' : k === 'site' ? SITE_LABEL : opts?.wa.find(w => w.key === k)?.label ?? k);
  const chosen = (story ? 1 : 0) + wa.length + (folder ? 1 : 0);
  const chip = (on: boolean) => cn('rounded-full border px-2.5 py-1 text-[11px] min-h-0 inline-flex items-center gap-1', on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground');

  return (
    <section className="rounded-xl border p-3 space-y-2">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-sm font-semibold min-h-0">
        <span className="flex items-center gap-1.5"><Send className="h-4 w-4" /> Post it</span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (!opts ? <p className="text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> …</p> : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {opts.story && <button type="button" className={chip(story)} onClick={() => setStory(s => !s)}><Instagram className="h-3 w-3" /> Story{opts.story === 'share' ? ' (share)' : ''}</button>}
            {opts.wa.map(w => (
              <button key={w.key} type="button" className={chip(wa.includes(w.key))} onClick={() => setWa(v => (v.includes(w.key) ? v.filter(x => x !== w.key) : [...v, w.key]))}>
                <MessageCircle className="h-3 w-3" /> {w.label}
              </button>
            ))}
          </div>
          {opts.site.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px]">
              <Globe className="h-3 w-3 shrink-0" />
              <select value={folder} onChange={e => setFolder(e.target.value)} className="flex-1 min-w-0 rounded-md border bg-background px-2 py-1 text-base sm:text-[11px]">
                <option value="">Not on {SITE_LABEL}</option>
                {opts.site.map(c => <option key={c.folder} value={c.folder}>{c.label}</option>)}
              </select>
            </label>
          )}
          {wa.length > 0 && <Textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} className="text-base sm:text-xs" aria-label="WhatsApp caption" />}
          <Button size="sm" className="w-full" disabled={!ready || busy || !chosen} onClick={post}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />} Post{chosen ? ` to ${chosen}` : ''}
          </Button>
          {shareFile && (
            <Button size="sm" variant="outline" className="w-full" onClick={() => navigator.share({ files: [shareFile] }).then(() => setShareFile(null)).catch(() => undefined)}>
              <Instagram className="h-4 w-4 mr-1" /> Share the story
            </Button>
          )}
          {results.length > 0 && (
            <ul className="text-[11px] space-y-0.5">
              {results.map(r => (
                <li key={r.key} className={cn('flex items-start gap-1', r.ok ? 'text-success' : 'text-destructive')}>
                  {r.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                  <span>{label(r.key)}{r.note ? ` — ${r.note}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
