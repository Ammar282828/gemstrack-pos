'use client';

import React from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { FileClock, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { listDrafts, clearDraft, summarizeDraft, type DraftSummary } from '@/lib/form-drafts';

/**
 * Work started and never saved.
 *
 * It belongs here rather than in the sidebar: this is already the screen you
 * pass through to begin a sale, so it is the moment you would want to be told
 * you had one half-typed. Drafts live in this browser, so the list is read on
 * mount and is per device.
 */
export const UnfinishedWork: React.FC = () => {
  const { toast } = useToast();
  const [drafts, setDrafts] = React.useState<DraftSummary[]>([]);

  const refresh = React.useCallback(() => {
    // Never let a stale draft take the page down with it.
    try { setDrafts(listDrafts().map(summarizeDraft)); } catch { setDrafts([]); }
  }, []);
  React.useEffect(refresh, [refresh]);

  if (!drafts.length) return null;

  return (
    <div className="space-y-2">
      {drafts.map(d => {
        let when = 'recently';
        try { when = formatDistanceToNow(new Date(d.savedAt), { addSuffix: true }); } catch { /* keep fallback */ }
        return (
          <Card key={`${d.kind}:${d.id}`}>
            <CardContent className="p-4 flex items-center gap-3 flex-wrap">
              <FileClock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">
                  Unfinished {d.noun.toLowerCase()} · {d.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.detail}{d.detail && ' · '}last typed {when}
                </p>
              </div>
              {/* Two buttons need more room than the one on the bill-in-progress
                  card above, so on a phone they take their own line rather than
                  squeezing the customer name into three wrapped words. */}
              <div className="flex gap-2 w-full justify-end sm:w-auto sm:flex-shrink-0">
                <Button asChild size="sm" variant="outline">
                  <Link href={d.href}>Pick up <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    clearDraft(d.kind, d.id);
                    refresh();
                    toast({ title: 'Discarded', description: `The unfinished ${d.noun.toLowerCase()} has been removed.` });
                  }}
                >
                  Discard
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
