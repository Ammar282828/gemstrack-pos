'use client';

/**
 * Saved: the ads kept from the maker, in the owner's folders, and — beside them — the ads already in the
 * ad account, any of which can be kept in a folder too. A saved ad opens in the maker as it was left.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { FolderPlus, Folder, Loader2, Search, Trash2, Download, Brush, Megaphone, Pencil, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AdFolder, SavedAd } from '@/lib/ads/studio/saved';
import { folderCounts, inFolder, type FolderView } from '@/lib/ads/studio/saved-shape';
import { AD_FORMATS, type AdFormat, type AdTemplateId } from '@/lib/ads/studio/templates';
import type { StoryDoc } from '@/lib/social/editor';
import type { GoalKey } from '@/lib/ads/plan';
import type { TreeCampaign } from '@/lib/ads/shape';
import { api, authHeaders } from '../ads-kit';
import { downloadBlob, safeName, type WorkPhoto } from './studio-kit';

/** A saved ad on its way back into the maker. */
export interface SavedRestore {
  id: string; name: string; folder: string | null;
  work: WorkPhoto; doc: StoryDoc;
  format: AdFormat; template: AdTemplateId; fields: Record<string, string>; price: string;
  text: string; headline: string; goal: GoalKey; link: string;
}

async function file(id: string, key: 'image' | 'photo' | 'doc'): Promise<Blob> {
  const res = await fetch(`/api/ads/studio/saved/${id}?key=${key}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `It didn’t come (${res.status}).`);
  return res.blob();
}

export function useSaved() {
  const [data, setData] = useState<{ folders: AdFolder[]; items: SavedAd[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ folders: AdFolder[]; items: SavedAd[] }>('/api/ads/studio/saved').then(d => { setData(d); setError(null); }).catch(e => setError(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { load(); }, [load]);
  return { data, error, load };
}

const ACCOUNT = '__account';

export function SavedSection({ onOpen }: { onOpen: (r: SavedRestore) => void }) {
  const { toast } = useToast();
  const { data, error, load } = useSaved();
  const [view, setView] = useState<FolderView>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<SavedAd | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const counts = useMemo(() => folderCounts(data?.items ?? []), [data]);
  const shown = useMemo(() => inFolder(data?.items ?? [], view, q), [data, view, q]);
  const folder = data?.folders.find(f => f.id === view) ?? null;

  const addFolder = async () => {
    if (!newFolder?.trim()) { setNewFolder(null); return; }
    try { const d = await api<{ folder: AdFolder }>('/api/ads/studio/saved/folders', { body: { name: newFolder } }); setNewFolder(null); await load(); setView(d.folder.id); }
    catch (e) { toast({ title: 'Couldn’t make the folder', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };
  const renameFolder = async () => {
    if (!folder) return;
    const name = prompt('Folder name', folder.name);
    if (!name?.trim()) return;
    await api('/api/ads/studio/saved/folders', { method: 'PATCH', body: { id: folder.id, name } }).catch(() => undefined);
    load();
  };
  const dropFolder = async () => {
    if (!folder || !confirm(`Delete the folder “${folder.name}”? Its ads stay, unfiled.`)) return;
    await api(`/api/ads/studio/saved/folders?id=${folder.id}`, { method: 'DELETE' }).catch(() => undefined);
    setView('all'); load();
  };

  const reopen = async (s: SavedAd) => {
    setBusy(s.id);
    try {
      const [photo, doc] = await Promise.all([file(s.id, 'photo'), file(s.id, 'doc').then(b => b.text()).then(t => JSON.parse(t) as StoryDoc)]);
      onOpen({
        id: s.id, name: s.name, folder: s.folder, doc, format: s.format, template: s.template, fields: s.fields, price: s.price,
        text: s.text, headline: s.headline, goal: s.goal, link: s.link,
        work: { asset: null, blob: photo, note: s.name, clean: true },
      });
    } catch (e) { toast({ title: 'Couldn’t open it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };

  const chip = (on: boolean) => cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap min-h-0', on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground');

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button type="button" className={chip(view === 'all')} onClick={() => setView('all')}>All <span className="opacity-70">{data?.items.length ?? ''}</span></button>
        {(counts[''] ?? 0) > 0 && <button type="button" className={chip(view === 'unfiled')} onClick={() => setView('unfiled')}>Unfiled <span className="opacity-70">{counts['']}</span></button>}
        {data?.folders.map(f => <button key={f.id} type="button" className={chip(view === f.id)} onClick={() => setView(f.id)}><Folder className="h-3.5 w-3.5" /> {f.name} <span className="opacity-70">{counts[f.id] ?? 0}</span></button>)}
        {newFolder === null
          ? <button type="button" className={chip(false)} onClick={() => setNewFolder('')}><FolderPlus className="h-3.5 w-3.5" /> Folder</button>
          : <form onSubmit={e => { e.preventDefault(); addFolder(); }} className="flex gap-1"><Input autoFocus value={newFolder} onChange={e => setNewFolder(e.target.value)} onBlur={addFolder} placeholder="Name" className="h-8 w-36 text-base sm:text-xs" /></form>}
        <button type="button" className={chip(view === ACCOUNT)} onClick={() => setView(ACCOUNT)}><Megaphone className="h-3.5 w-3.5" /> In the ad account</button>
      </div>

      {view === ACCOUNT ? <AccountAds folders={data?.folders ?? []} onKept={load} /> : (
        <>
          <div className="flex items-center gap-2">
            <div className="relative flex-1"><Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find" className="h-9 pl-8 text-base sm:text-sm" /></div>
            {folder && <><Button variant="ghost" size="icon" className="h-9 w-9 min-h-0" aria-label="Rename folder" onClick={renameFolder}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="h-9 w-9 min-h-0" aria-label="Delete folder" onClick={dropFolder}><Trash2 className="h-4 w-4" /></Button></>}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : !data ? <p className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> …</p>
            : !shown.length ? <p className="text-sm text-muted-foreground py-8 text-center">{data.items.length ? 'Nothing here.' : 'Nothing saved yet — “Save” in Make keeps an ad here.'}</p> : (
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {shown.map(s => (
                  <button key={s.id} type="button" onClick={() => setOpen(s)} className="card rounded-xl border overflow-hidden text-left bg-card min-h-0">
                    <div className="bg-muted grid place-items-center" style={{ aspectRatio: '4 / 5' }}>
                      {s.thumb ? <img src={s.thumb} alt="" className="max-h-full max-w-full object-contain" /> : null}
                    </div>
                    <p className="px-2 pt-1.5 text-xs font-medium truncate">{s.name}</p>
                    <p className="px-2 pb-1.5 text-[10px] text-muted-foreground">{s.format === 'custom' ? 'Custom' : AD_FORMATS[s.format]?.short ?? s.format}{s.fromAd ? ' · from the account' : ''}</p>
                  </button>
                ))}
              </div>
            )}
        </>
      )}

      <SavedDialog item={open} folders={data?.folders ?? []} busy={busy === open?.id} onClose={() => setOpen(null)} onChanged={load} onReopen={reopen} />
    </div>
  );
}

function SavedDialog({ item, folders, busy, onClose, onChanged, onReopen }: { item: SavedAd | null; folders: AdFolder[]; busy: boolean; onClose: () => void; onChanged: () => void; onReopen: (s: SavedAd) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    setUrl(null); setName(item?.name ?? '');
    if (!item) return;
    let u: string | null = null;
    file(item.id, 'image').then(b => { u = URL.createObjectURL(b); setUrl(u); }).catch(() => undefined);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [item]);
  if (!item) return null;
  const patch = async (b: Record<string, unknown>) => { await api('/api/ads/studio/saved', { method: 'PATCH', body: { id: item.id, ...b } }).catch(() => undefined); onChanged(); };
  const canReopen = !!item.parts.doc && !!item.parts.photo;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="sr-only">{item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-muted grid place-items-center min-h-40">{url ? <img src={url} alt={item.name} className="max-h-[55vh] w-auto rounded-lg" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}</div>
          <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== item.name) patch({ name }); }} className="h-9 text-base sm:text-sm font-medium" aria-label="Name" />
          {(item.text || item.headline) && <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-4">{[item.headline, item.text].filter(Boolean).join('\n')}</p>}
          <select value={item.folder ?? ''} onChange={e => { patch({ folder: e.target.value || null }); onClose(); }} className="w-full rounded-md border bg-background px-3 h-9 text-base sm:text-sm">
            <option value="">Unfiled</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            {canReopen && <Button size="sm" disabled={busy} onClick={() => onReopen(item)}>{busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brush className="h-4 w-4 mr-1" />} Open in Make</Button>}
            {item.fromAd && <Button size="sm" variant="outline" asChild><Link href={`/ads/campaigns?ad=${item.fromAd}`}>In Campaigns</Link></Button>}
            <Button size="sm" variant="outline" disabled={!url} onClick={async () => downloadBlob(await file(item.id, 'image'), `${safeName(item.name)}.jpg`)}><Download className="h-4 w-4 mr-1" /> Download</Button>
            <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={async () => { if (!confirm(`Delete “${item.name}”?`)) return; await api(`/api/ads/studio/saved?id=${item.id}`, { method: 'DELETE' }).catch(() => undefined); onClose(); onChanged(); }}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The ads already in the ad account, any of which can be kept in a folder. */
function AccountAds({ folders, onKept }: { folders: AdFolder[]; onKept: () => void }) {
  const { toast } = useToast();
  const [ads, setAds] = useState<{ id: string; name: string; image: string | null; status: string; where: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<{ campaigns: TreeCampaign[] }>('/api/ads/campaigns?range=maximum')
      .then(d => setAds(d.campaigns.flatMap(c => c.adsets.flatMap(s => s.ads.map(a => ({ id: a.id, name: a.name, image: a.image ?? a.thumbnail, status: a.effectiveStatus, where: `${c.name} › ${s.name}` }))))))
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (ads ?? []).filter(a => words.every(w => `${a.name} ${a.where}`.toLowerCase().includes(w)));
  const keep = async (id: string) => {
    setBusy(id);
    try { await api('/api/ads/studio/saved', { body: { fromAd: id, folder: to || null } }); toast({ title: `Kept${to ? ` in ${folders.find(f => f.id === to)?.name}` : ''}` }); onKept(); }
    catch (e) { toast({ title: 'Couldn’t keep it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(null); }
  };
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!ads) return <p className="text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> …</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1"><Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Find" className="h-9 pl-8 text-base sm:text-sm" /></div>
        <select value={to} onChange={e => setTo(e.target.value)} className="rounded-md border bg-background px-2 h-9 text-base sm:text-xs max-w-[45%]" aria-label="Keep into">
          <option value="">Keep into: Unfiled</option>
          {folders.map(f => <option key={f.id} value={f.id}>Keep into: {f.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {shown.map(a => (
          <div key={a.id} className="card rounded-xl border overflow-hidden bg-card">
            {a.image ? <img src={a.image} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-muted" />}
            <p className="px-2 pt-1.5 text-xs font-medium truncate" title={a.where}>{a.name}</p>
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-[10px] text-muted-foreground pl-1">{a.status === 'ACTIVE' ? 'Running' : a.status.toLowerCase().replace(/_/g, ' ')}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 min-h-0" aria-label="Keep in a folder" disabled={busy === a.id} onClick={() => keep(a.id)}>{busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Make's "Save": into a folder, over itself once saved, or as a new one. */
export function SaveButton({ ready, savedId, folder: initialFolder, onSave }: { ready: boolean; savedId: string | null; folder: string | null; onSave: (folder: string | null, asNew: boolean) => Promise<void> }) {
  const { data, load } = useSaved();
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState<string>(initialFolder ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFolder(initialFolder ?? ''); }, [initialFolder]);
  useEffect(() => { if (open) load(); }, [open, load]);
  const go = async (asNew: boolean) => { setBusy(true); try { await onSave(folder || null, asNew); setOpen(false); } finally { setBusy(false); } };
  if (!open) return <Button variant="outline" size="sm" disabled={!ready} onClick={() => setOpen(true)}><Save className="h-4 w-4 mr-1" /> {savedId ? 'Save' : 'Save to…'}</Button>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 w-full">
      <select value={folder} onChange={e => setFolder(e.target.value)} className="rounded-md border bg-background px-2 h-9 text-base sm:text-xs flex-1 min-w-0" aria-label="Folder">
        <option value="">Unfiled</option>
        {data?.folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <Button size="sm" disabled={busy} onClick={() => go(false)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
      {savedId && <Button size="sm" variant="outline" disabled={busy} onClick={() => go(true)}>As new</Button>}
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>✕</Button>
    </div>
  );
}
