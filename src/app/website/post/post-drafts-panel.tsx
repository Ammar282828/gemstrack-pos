'use client';

import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ImageIcon, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { POST_DRAFT_MAX_DAYS, deletePostDraft, listPostDrafts, type PostDraft } from '@/lib/social/post-drafts';

const ago = (iso: string) => { try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return 'recently'; } };

/** A draft's lead photo, small — its own object URL, let go when the row goes. */
function Thumb({ blob }: { blob?: Blob | null }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
    </span>
  );
}

/**
 * Post a Piece's drafts on this device: continue any of them (the piece on the page is kept first),
 * start a new piece, or delete one. The piece on the page is marked.
 */
export function PostDraftsDialog({ open, onOpenChange, currentId, onContinue, onNew, onChanged, onDeletedCurrent }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentId: string | null;
  onContinue: (id: string) => void;
  onNew: () => void;
  onChanged: () => void;
  /** The piece on the page was deleted: the page clears. */
  onDeletedCurrent: () => void;
}) {
  const [drafts, setDrafts] = React.useState<PostDraft[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setDrafts(null);
    listPostDrafts().then(setDrafts).catch(() => setDrafts([]));
  }, [open]);

  const remove = async (id: string) => {
    await deletePostDraft(id).catch(() => undefined);
    setDrafts(d => (d ? d.filter(x => x.id !== id) : d));
    if (id === currentId) onDeletedCurrent();
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Drafts</DialogTitle>
          <DialogDescription>
            Pieces being made, kept on this device with their photos — each as it was left. One leaves once it is published
            or queued, and after {POST_DRAFT_MAX_DAYS} days untouched.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {drafts === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Looking…</p>
          ) : drafts.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nothing in progress. A piece is kept here as soon as it has a photo or a headline.</p>
          ) : drafts.map(d => {
            const here = d.id === currentId;
            return (
              <div key={d.id} className={cn('flex items-center gap-3 rounded-lg border p-2', here && 'border-primary bg-primary/5')}>
                <Thumb blob={d.thumb} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.title || 'No headline yet'}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.photos.length} photo{d.photos.length === 1 ? '' : 's'} · {here ? 'on the page now' : `last changed ${ago(d.updatedAt)}`}
                  </p>
                </div>
                {!here && <Button size="sm" onClick={() => onContinue(d.id)}>Continue</Button>}
                <Button size="icon" variant="ghost" className="h-9 w-9 min-h-0 flex-shrink-0" aria-label={here ? 'Delete this piece and clear the page' : `Delete ${d.title || 'this draft'}`}
                  onClick={() => { void remove(d.id); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
        <Button variant="outline" onClick={onNew}><Plus className="mr-1.5 h-4 w-4" />New piece{currentId ? ' — this one stays in Drafts' : ''}</Button>
      </DialogContent>
    </Dialog>
  );
}
