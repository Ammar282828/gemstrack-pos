"use client";

/**
 * Shopify orders that are not in the POS yet — listed, ticked, then imported.
 *
 * One direction only: this reads from Shopify and writes to the POS. Nothing
 * here creates or modifies anything on the storefront.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { RefreshCw, Loader2, Download, CheckCircle2, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface PullItem {
  id: string;
  title: string;
  subtitle?: string;
  date?: string;
  amount?: number;
}

const fmtDate = (d?: string) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' });
};

export const ShopifyPullPanel: React.FC = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<PullItem[] | null>(null);
  const [meta, setMeta] = useState<{ since: number; olderSkipped: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');

  const check = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shopify/pull');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not reach Shopify');
      setOrders(json.orders || []);
      setMeta({ since: json.since, olderSkipped: json.olderSkipped || 0 });
      setPicked(new Set());
    } catch (e: unknown) {
      toast({ title: 'Check failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const toggle = (id: string) => setPicked(p => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const visible = useMemo(() => {
    const list = orders || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(i =>
      i.title.toLowerCase().includes(needle) || (i.subtitle || '').toLowerCase().includes(needle));
  }, [orders, q]);

  const allOn = visible.length > 0 && visible.every(i => picked.has(i.id));
  const toggleAll = () => setPicked(p => {
    const next = new Set(p);
    for (const i of visible) { if (allOn) next.delete(i.id); else next.add(i.id); }
    return next;
  });

  const runImport = async () => {
    setImporting(true);
    try {
      const res = await fetch('/api/shopify/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: [...picked] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Import failed');
      const count = json.imported?.orders || 0;
      toast({ title: 'Imported', description: `${count} order${count === 1 ? '' : 's'} added to the POS.` });
      if (json.errors?.length) {
        toast({ title: `${json.errors.length} failed`, description: json.errors[0], variant: 'destructive' });
      }
      await check();
    } catch (e: unknown) {
      toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const selectedTotal = useMemo(
    () => (orders || []).filter(o => picked.has(o.id)).reduce((s, o) => s + (o.amount || 0), 0),
    [orders, picked],
  );

  return (
    <div className="space-y-3">
      <Separator />

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium">Import orders from Shopify</p>
          <p className="text-xs text-muted-foreground">
            Shopify orders after {meta ? `#${meta.since}` : 'the cutoff'} that aren&apos;t in the POS yet.
            Nothing is written back to Shopify.
          </p>
        </div>
        <Button onClick={check} disabled={loading} size="sm" variant="outline" className="flex-shrink-0">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {loading ? 'Checking…' : orders ? 'Re-check' : 'Check for new orders'}
        </Button>
      </div>

      {orders && orders.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 py-3">
          <CheckCircle2 className="h-4 w-4" />
          Every Shopify order after #{meta?.since} is already in the POS.
        </div>
      )}

      {/* The older backlog is stated rather than hidden, so an empty list is
          never mistaken for "there is nothing left anywhere". */}
      {meta && meta.olderSkipped > 0 && (
        <p className="text-xs text-muted-foreground">
          {meta.olderSkipped} older order{meta.olderSkipped === 1 ? '' : 's'} at or below #{meta.since} {meta.olderSkipped === 1 ? 'is' : 'are'} not
          offered here — they predate the POS.
        </p>
      )}

      {orders && orders.length > 0 && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">{orders.length} not imported</Badge>
            <div className="relative flex-1 min-w-[12rem]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8 h-9" placeholder="Filter by order number or customer…"
                value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={toggleAll}>
              {allOn ? 'Clear' : 'Select'} all {visible.length}
            </Button>
            {picked.size > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {picked.size} selected · PKR {selectedTotal.toLocaleString()}
              </span>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nothing matches that search.</p>
          ) : (
            <ScrollArea className={visible.length > 6 ? 'h-[24rem]' : ''}>
              <div className="space-y-1 pr-2">
                {visible.map(item => {
                  const on = picked.has(item.id);
                  return (
                    <label key={item.id}
                      className={cn(
                        'flex items-start gap-3 rounded-md border p-2.5 cursor-pointer transition-colors',
                        on ? 'bg-primary/5 border-primary/40' : 'hover:bg-muted/50',
                      )}>
                      <Checkbox className="mt-0.5 flex-shrink-0" checked={on}
                        onCheckedChange={() => toggle(item.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-medium text-sm font-mono">{item.title}</span>
                          {item.amount != null && item.amount > 0 && (
                            <span className="text-sm tabular-nums flex-shrink-0">
                              PKR {item.amount.toLocaleString()}
                            </span>
                          )}
                        </span>
                        {item.subtitle && (
                          <span className="block text-xs text-muted-foreground truncate">{item.subtitle}</span>
                        )}
                        {item.date && (
                          <span className="block text-[11px] text-muted-foreground">{fmtDate(item.date)}</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          <Button onClick={runImport} disabled={importing || picked.size === 0} className="w-full sm:w-auto">
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {importing ? 'Importing…' : picked.size === 0 ? 'Select orders to import' : `Import ${picked.size} order${picked.size === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </div>
  );
};
