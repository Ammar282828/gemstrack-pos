'use client';

/**
 * Saved (plan §5.2): one shelf for everything kept.
 *
 *   folders       the shop's `designs` (and, for owner and marketing, the saved ads of the old Studio read through as
 *                 `saved:<id>`), in the folders they share (`ad_folders`)
 *   On this device   the drafts this browser keeps while a design is made (post-drafts.ts): this page's own open
 *                 here, a Post a piece draft opens in Post a piece
 *   In the ad account   the ads already running in Meta, any of which can be kept in a folder (owner and marketing)
 *
 * What a person may see is the API's business (designGate / scope); this only hides what the API would refuse.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Download, Loader2, Megaphone, Pencil, Save, Smartphone, Trash2, FolderOpen } from 'lucide-react';
import { ChipRow, EmptyState, FilterChip, SearchField } from '@/components/ledger';
import { cn } from '@/lib/utils';
import type { AdFolder } from '@/lib/ads/studio/saved';
import type { TreeCampaign } from '@/lib/ads/shape';
import type { DesignRecord } from '@/lib/design/model';
import { deletePostDraft, listPostDrafts, type PostDraft } from '@/lib/social/post-drafts';
import { api, authHeaders } from '../ads/ads-kit';
import { downloadBlob, safeName } from './studio-kit';
import { isDesignDraft, kindLabel } from './design-state';

const DEVICE = '__device';
const ACCOUNT = '__account';
const UNFILED = '__unfiled';
const ALL = '__all';

// ── What the shelf reads ───────────────────────────────────────────────────

export function useDesigns() {
  const [data, setData] = useState<{ folders: AdFolder[]; items: DesignRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ folders: AdFolder[]; items: DesignRecord[] }>('/api/design/designs')
    .then(d => { setData(d); setError(null); }).catch(e => setError(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { void load(); }, [load]);
  return { data, error, load };
}

export function useDeviceDrafts() {
  const [drafts, setDrafts] = useState<PostDraft[] | null>(null);
  const load = useCallback(() => listPostDrafts().then(setDrafts).catch(() => setDrafts([])), []);
  useEffect(() => { void load(); }, [load]);
  return { drafts, load };
}

/** A draft's lead photograph, as an address that lives as long as the card. */
function useThumb(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) { setUrl(null); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

const when = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };

// ── The shelf ──────────────────────────────────────────────────────────────

export function SavedShelf({ adsOk, onOpen, onOpenDraft }: { adsOk: boolean; onOpen: (r: DesignRecord) => void; onOpenDraft: (id: string) => void }) {
  const { toast } = useToast();
  const { data, error, load } = useDesigns();
  const { drafts, load: loadDrafts } = useDeviceDrafts();
  const [view, setView] = useState<string>(ALL);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<DesignRecord | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const items = data?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.folder ?? ''] = (c[i.folder ?? ''] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(i => (view === ALL || (view === UNFILED ? !i.folder : i.folder === view))
      && words.every(w => `${i.name} ${i.fields.headline} ${i.kind}`.toLowerCase().includes(w)));
  }, [items, view, q]);
  const folder = data?.folders.find(f => f.id === view) ?? null;

  const addFolder = async () => {
    if (!newFolder?.trim()) { setNewFolder(null); return; }
    try {
      const d = await api<{ folder: AdFolder }>('/api/design/designs/folders', { body: { name: newFolder } });
      setNewFolder(null); await load(); setView(d.folder.id);
    } catch (e) { toast({ title: 'Couldn’t make the folder', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
  };
  const renameFolder = async () => {
    if (!folder) return;
    const name = prompt('Folder name', folder.name);
    if (!name?.trim()) return;
    await api('/api/design/designs/folders', { method: 'PATCH', body: { id: folder.id, name } }).catch(() => undefined);
    void load();
  };
  const dropFolder = async () => {
    if (!folder || !confirm(`Delete the folder “${folder.name}”? Its designs stay, unfiled.`)) return;
    await api(`/api/design/designs/folders?id=${folder.id}`, { method: 'DELETE' }).catch(() => undefined);
    setView(ALL); void load();
  };

  return (
    <div className="space-y-3">
      <ChipRow label="Folders">
        <FilterChip title="All" count={items.length} chosen={view === ALL} onClick={() => setView(ALL)} />
        {(counts[''] ?? 0) > 0 && <FilterChip title="Unfiled" count={counts['']} chosen={view === UNFILED} onClick={() => setView(UNFILED)} />}
        {data?.folders.map(f => <FilterChip key={f.id} title={f.name} count={counts[f.id] ?? 0} chosen={view === f.id} onClick={() => setView(f.id)} />)}
        {newFolder === null
          ? <FilterChip title="New folder" chosen={false} onClick={() => setNewFolder('')} />
          : <form onSubmit={e => { e.preventDefault(); void addFolder(); }} className="flex shrink-0 items-center"><Input autoFocus value={newFolder} onChange={e => setNewFolder(e.target.value)} onBlur={() => void addFolder()} placeholder="Name" className="h-11 w-40 rounded-full text-base" /></form>}
        <FilterChip title="On this device" count={drafts?.length ?? undefined} chosen={view === DEVICE} onClick={() => setView(DEVICE)} />
        {adsOk && <FilterChip title="In the ad account" chosen={view === ACCOUNT} onClick={() => setView(ACCOUNT)} />}
      </ChipRow>

      {view === DEVICE ? (
        <DeviceDrafts drafts={drafts} onOpen={onOpenDraft} onChanged={loadDrafts} />
      ) : view === ACCOUNT && adsOk ? (
        <AccountAds folders={data?.folders ?? []} onKept={load} />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <SearchField value={q} onChange={setQ} placeholder="Find a design" className="flex-1" />
            {folder && (
              <>
                <Button variant="ghost" size="icon" className="h-9 w-9 min-h-0" aria-label="Rename folder" onClick={renameFolder}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-9 w-9 min-h-0" aria-label="Delete folder" onClick={dropFolder}><Trash2 className="h-4 w-4" /></Button>
              </>
            )}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p>
            : !data ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Opening the shelf…</p>
            : !shown.length ? (
              <EmptyState icon={<FolderOpen />} title={items.length ? 'Nothing here' : 'Nothing saved yet'}
                description={items.length ? 'No design in this folder matches.' : 'Save a design from the workspace and it waits here, in any folder you make.'} />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {shown.map(d => (
                  <button key={d.id} type="button" onClick={() => setOpen(d)} className="min-h-0 overflow-hidden rounded-card bg-card text-left">
                    <div className="grid place-items-center bg-muted" style={{ aspectRatio: '4 / 5' }}>
                      {d.thumb ? <img src={d.thumb} alt="" className="max-h-full max-w-full object-contain" /> : null}
                    </div>
                    <p className="truncate px-3 pt-2 text-ios-sub font-medium">{d.name}</p>
                    <p className="truncate px-3 pb-2.5 text-ios-foot text-muted-foreground">{kindLabel(d.kind)} · {d.pages.length} size{d.pages.length === 1 ? '' : 's'} · {when(d.updated)}</p>
                  </button>
                ))}
              </div>
            )}
        </>
      )}

      <DesignDialog item={open} folders={data?.folders ?? []} onClose={() => setOpen(null)} onChanged={load} onOpen={r => { setOpen(null); onOpen(r); }} />
    </div>
  );
}

// ── One design ─────────────────────────────────────────────────────────────

const fileOf = async (id: string, key: string): Promise<Blob> => {
  const res = await fetch(`/api/design/designs/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `It didn’t come (${res.status}).`);
  return res.blob();
};

function DesignDialog({ item, folders, onClose, onChanged, onOpen }: {
  item: DesignRecord | null; folders: AdFolder[]; onClose: () => void; onChanged: () => void; onOpen: (r: DesignRecord) => void;
}) {
  const [shown, setShown] = useState<DesignRecord | null>(item);
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  useEffect(() => { if (item) setShown(item); }, [item]);
  useEffect(() => {
    setUrl(null); setName(item?.name ?? '');
    if (!item) return;
    let u: string | null = null;
    let alive = true;
    fileOf(item.id, `image:${item.master}`).then(b => { if (!alive) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => undefined);
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [item]);
  const d = shown;
  if (!d) return null;
  const patch = async (b: Record<string, unknown>) => { await api(`/api/design/designs/${encodeURIComponent(d.id)}`, { method: 'PATCH', body: b }).catch(() => undefined); onChanged(); };
  const canOpen = Object.keys(d.files).some(k => k.startsWith('doc:'));
  return (
    <Dialog open={!!item} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle className="sr-only">{d.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid min-h-40 place-items-center rounded-lg bg-muted">{url ? <img src={url} alt={d.name} className="max-h-[55vh] w-auto rounded-lg" /> : d.thumb ? <img src={d.thumb} alt="" className="max-h-[40vh] w-auto rounded-lg opacity-70" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}</div>
          <Input value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== d.name) void patch({ name }); }} className="h-9 text-base font-medium sm:text-sm" aria-label="Name" />
          <p className="text-ios-foot text-muted-foreground">{kindLabel(d.kind)} · {d.pages.map(p => p.label).join(', ')}{d.scope === 'ads' ? ' · ads' : ''}</p>
          <select value={d.folder ?? ''} onChange={e => { void patch({ folder: e.target.value || null }); onClose(); }} className="h-9 w-full rounded-md border bg-background px-3 text-base sm:text-sm" aria-label="Folder">
            <option value="">Unfiled</option>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            {canOpen && <Button size="sm" onClick={() => onOpen(d)}><FolderOpen className="mr-1 h-4 w-4" /> Open</Button>}
            <Button size="sm" variant="outline" disabled={!url} onClick={async () => downloadBlob(await fileOf(d.id, `image:${d.master}`), `${safeName(d.name)}.jpg`)}><Download className="mr-1 h-4 w-4" /> Download</Button>
            <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={async () => {
              if (!confirm(`Delete “${d.name}”?`)) return;
              await api(`/api/design/designs/${encodeURIComponent(d.id)}`, { method: 'DELETE' }).catch(() => undefined);
              onClose(); onChanged();
            }}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── On this device ─────────────────────────────────────────────────────────

function DeviceDrafts({ drafts, onOpen, onChanged }: { drafts: PostDraft[] | null; onOpen: (id: string) => void; onChanged: () => void }) {
  if (!drafts) return <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> …</p>;
  if (!drafts.length) return <EmptyState icon={<Smartphone />} title="No drafts on this device" description="A design is kept here as you make it, and for 30 days after." />;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {drafts.map(d => <DraftRow key={d.id} draft={d} onOpen={onOpen} onChanged={onChanged} />)}
    </div>
  );
}

function DraftRow({ draft, onOpen, onChanged }: { draft: PostDraft; onOpen: (id: string) => void; onChanged: () => void }) {
  const thumb = useThumb(draft.thumb);
  const mine = isDesignDraft(draft.state);
  const body = (
    <>
      <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">{thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <Smartphone className="h-5 w-5 text-muted-foreground" />}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-ios-sub font-medium">{draft.title || 'Untitled'}</span>
        <span className="block truncate text-ios-foot text-muted-foreground">{mine ? "Design" : "Classic Post a piece"} draft · {when(draft.updatedAt)}</span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-2 rounded-card bg-card p-2">
      {mine
        ? <button type="button" onClick={() => onOpen(draft.id)} className="flex min-h-0 min-w-0 flex-1 items-center gap-3">{body}</button>
        : <Link href={`/design/classic/post?draft=${encodeURIComponent(draft.id)}`} className="flex min-w-0 flex-1 items-center gap-3">{body}</Link>}
      <Button variant="ghost" size="icon" className="h-9 w-9 min-h-0 text-muted-foreground" aria-label="Delete this draft" onClick={async () => {
        if (!confirm('Delete this draft from this device?')) return;
        await deletePostDraft(draft.id).catch(() => undefined);
        onChanged();
      }}><Trash2 className="h-4 w-4" /></Button>
    </div>
  );
}

// ── In the ad account ──────────────────────────────────────────────────────

/** The ads already in the ad account, any of which can be kept in a folder (through the Saved ads route, as ever). */
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
  if (!ads) return <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> …</p>;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Find an ad" className="flex-1" />
        <select value={to} onChange={e => setTo(e.target.value)} className="h-11 max-w-[45%] rounded-full border bg-background px-3 text-base sm:text-xs" aria-label="Keep into">
          <option value="">Keep into: Unfiled</option>
          {folders.map(f => <option key={f.id} value={f.id}>Keep into: {f.name}</option>)}
        </select>
      </div>
      {!shown.length && <EmptyState icon={<Megaphone />} title="No ads" description="The ad account has none that match." />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map(a => (
          <div key={a.id} className="overflow-hidden rounded-card bg-card">
            {a.image ? <img src={a.image} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-muted" />}
            <p className="truncate px-3 pt-2 text-ios-sub font-medium" title={a.where}>{a.name}</p>
            <div className="flex items-center justify-between px-2 pb-1.5">
              <span className="pl-1 text-ios-foot text-muted-foreground">{a.status === 'ACTIVE' ? 'Running' : a.status.toLowerCase().replace(/_/g, ' ')}</span>
              <Button variant="ghost" size="icon" className={cn('h-8 w-8 min-h-0')} aria-label="Keep in a folder" disabled={busy === a.id} onClick={() => void keep(a.id)}>{busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

