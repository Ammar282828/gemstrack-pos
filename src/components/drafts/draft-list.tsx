'use client';

import React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { doc, setDoc } from 'firebase/firestore';
import { ArrowRight, ClipboardList, FileClock, Receipt } from 'lucide-react';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { draftHref, type WorkDraft } from '@/lib/work-drafts';
import { deleteWorkDraft, useWorkDrafts } from './use-work-drafts';

const ago = (iso: string) => { try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return 'recently'; } };
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;

/** One draft: who it is for, what is in it, where and when it was last typed; continue or discard. */
export function DraftCard({ d, compact }: { d: WorkDraft; compact?: boolean }) {
  const { toast } = useToast();
  const discard = () => {
    void deleteWorkDraft(d.id);
    toast({
      title: 'Draft discarded',
      description: `${d.kind === 'order' ? 'Order' : 'Sale'} for ${d.title}.`,
      action: (
        <ToastAction altText="Undo" onClick={() => {
          const { id, ...rest } = d;
          void setDoc(doc(db, 'drafts', id), rest);
        }}>Undo</ToastAction>
      ),
    });
  };
  const Icon = d.kind === 'order' ? ClipboardList : Receipt;
  return (
    <Card>
      <CardContent className={cn('flex flex-wrap items-center gap-3', compact ? 'p-3' : 'p-4')}>
        <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{d.title}</p>
          <p className="text-xs text-muted-foreground">
            {d.detail}
            {d.total > 0 && <> · {pkr(d.total)}</>}
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            Last typed {ago(d.updatedAt)}{d.device ? ` on ${d.device}` : ''}
            {d.leftOut?.includes('photos') && ' · sample photos too large to keep'}
          </p>
        </div>
        <div className="flex w-full justify-end gap-2 sm:w-auto sm:flex-shrink-0">
          <Button asChild size="sm">
            <Link href={draftHref(d)}>Continue <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Unfinished work where a sale or an order begins (New Sale, New Order): the few most recent,
 * and the way to all of them. Nothing at all when there is nothing unfinished.
 */
export function DraftsShortcut({ kind, exclude, limit = 3 }: { kind?: 'order' | 'sale'; exclude?: string | null; limit?: number }) {
  const { drafts } = useWorkDrafts(kind);
  const list = drafts.filter(d => d.id !== exclude);
  if (!list.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileClock className="h-4 w-4 text-primary" />
          {list.length === 1 ? 'An unfinished ' + (kind === 'order' ? 'order' : kind === 'sale' ? 'sale' : 'draft') : `${list.length} unfinished ${kind === 'order' ? 'orders' : kind === 'sale' ? 'sales' : 'drafts'}`}
        </p>
        {list.length > limit && <Link href="/drafts" className="text-xs font-medium text-primary hover:underline">All drafts</Link>}
      </div>
      {list.slice(0, limit).map(d => <DraftCard key={d.id} d={d} compact />)}
    </div>
  );
}
