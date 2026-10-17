'use client';

/**
 * A draft of the old Post a piece screen that Design could not open as a design (old-draft.ts says no when the
 * draft has no story or square to open): its words and photographs, read-only, to copy and download.
 * Nothing else is kept of that screen, so nothing is lost; it is the way out for a damaged draft.
 */

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Copy, Download, Loader2 } from 'lucide-react';
import { readPostDraft, type PostDraft } from '@/lib/social/post-drafts';
import type { OldDraftState } from './old-draft';
import { downloadBlob } from './studio-kit';

export function OldDraftView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [got, setGot] = useState<{ draft: PostDraft<OldDraftState>; urls: { id: string; name: string; url: string; blob: Blob }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true, made: string[] = [];
    setGot(null); setError(null);
    readPostDraft<OldDraftState>(id).then(r => {
      if (!alive) return;
      if (!r) { setError('That draft is no longer on this device.'); return; }
      const urls = r.draft.photos.flatMap(p => { const blob = r.blobs.get(p.id); if (!blob) return []; const url = URL.createObjectURL(blob); made.push(url); return [{ id: p.id, name: p.name, url, blob }]; });
      setGot({ draft: r.draft, urls });
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; made.forEach(URL.revokeObjectURL); };
  }, [id]);

  const s = got?.draft.state;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch { /* select and copy by hand */ } };
  return (
    <Dialog open={!!id} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogTitle>{got?.draft.title || 'An earlier draft'}</DialogTitle>
        <DialogDescription>This draft of the older Post a piece screen can’t be opened as a design. Here are its words and photographs to copy and keep.</DialogDescription>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!got && !error && <p className="text-sm text-muted-foreground"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> …</p>}
        {got && s && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {([['Headline', s.headline], ['Small line', s.kicker], ['Weight', s.weight], ['Metal', s.metal], ['Stones', s.stones]] as const).filter(([, v]) => v).map(([k, v]) => (
                <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></React.Fragment>
              ))}
            </dl>
            {s.caption && (
              <div className="space-y-1">
                <Textarea readOnly value={s.caption} rows={6} className="font-mono text-xs" aria-label="Caption" />
                <Button size="sm" variant="outline" onClick={() => void copy(s.caption!)}><Copy className="mr-1 h-4 w-4" /> Copy the caption</Button>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {got.urls.map(p => (
                <div key={p.id} className="space-y-1">
                  <img src={p.url} alt="" className="aspect-square w-full rounded-md object-cover" />
                  <Button size="sm" variant="outline" className="h-7 w-full px-1 text-[11px]" onClick={() => downloadBlob(p.blob, p.name || `${p.id}.jpg`)}><Download className="mr-1 h-3 w-3" /> Save</Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
