"use client";

/**
 * Recently removed — the way back from a clear-out that went too far.
 *
 * Removing a customer or a karigar anywhere in the app only hides them. Their ledger,
 * orders and invoices stay exactly where they are, still pointing at the same id, so
 * putting one back restores a whole account rather than a bare name.
 *
 * Emptying this list is the only thing in the app that actually destroys a record. It
 * says how much history goes with them before it will do it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Briefcase, Loader2, RotateCcw, Trash2, Users } from 'lucide-react';
import { PageShell } from '@/components/shared/page-shell';
import { PageBack } from '@/components/shared/page-back';
import { format, formatDistanceToNow } from 'date-fns';

export default function RecentlyRemovedPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const removedCustomers = useAppStore((s) => s.removedCustomers);
  const removedKarigars = useAppStore((s) => s.removedKarigars);
  const hisaabEntries = useAppStore((s) => s.hisaabEntries);
  const orders = useAppStore((s) => s.orders);
  const loadCustomers = useAppStore((s) => s.loadCustomers);
  const loadKarigars = useAppStore((s) => s.loadKarigars);
  const loadHisaab = useAppStore((s) => s.loadHisaab);
  const loadOrders = useAppStore((s) => s.loadOrders);
  const restoreCustomer = useAppStore((s) => s.restoreCustomer);
  const restoreKarigar = useAppStore((s) => s.restoreKarigar);
  const purgeRemoved = useAppStore((s) => s.purgeRemoved);

  useEffect(() => {
    loadCustomers();
    loadKarigars();
    loadHisaab();
    loadOrders();
  }, [loadCustomers, loadKarigars, loadHisaab, loadOrders]);

  /**
   * How much history each removed person still carries.
   *
   * This is the number that makes "Empty" a considered act rather than a reflex — a name
   * with 40 ledger entries behind it is not a stray duplicate somebody added twice.
   */
  const historyFor = useMemo(() => {
    const counts = new Map<string, { entries: number; orders: number }>();
    const bump = (id: string | undefined, key: 'entries' | 'orders') => {
      if (!id) return;
      const cur = counts.get(id) ?? { entries: 0, orders: 0 };
      cur[key] += 1;
      counts.set(id, cur);
    };
    for (const e of hisaabEntries) bump(e.entityId, 'entries');
    for (const o of orders) bump(o.customerId, 'orders');
    return counts;
  }, [hisaabEntries, orders]);

  const total = removedCustomers.length + removedKarigars.length;
  const totalEntries = [...removedCustomers, ...removedKarigars]
    .reduce((sum, p) => sum + (historyFor.get(p.id)?.entries ?? 0), 0);
  const totalOrders = removedCustomers
    .reduce((sum, c) => sum + (historyFor.get(c.id)?.orders ?? 0), 0);

  const restoreAll = async () => {
    setBusy('all');
    try {
      await Promise.all([
        ...removedCustomers.map((c) => restoreCustomer(c.id)),
        ...removedKarigars.map((k) => restoreKarigar(k.id)),
      ]);
      toast({ title: 'Put everything back', description: `${total} record(s) restored.` });
    } catch {
      toast({ title: 'Could not restore', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const empty = async () => {
    setBusy('purge');
    try {
      const result = await purgeRemoved();
      toast({
        title: 'Recently removed emptied',
        description: `${result.customers} customer(s) and ${result.karigars} karigar(s) permanently deleted.`,
      });
    } catch {
      toast({ title: 'Could not empty the list', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const Row = ({
    id, name, sub, removedAt, kind,
  }: { id: string; name: string; sub?: string; removedAt?: string; kind: 'customer' | 'karigar' }) => {
    const history = historyFor.get(id);
    const carries = [
      history?.entries ? `${history.entries} ledger entr${history.entries === 1 ? 'y' : 'ies'}` : null,
      history?.orders ? `${history.orders} order${history.orders === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');

    return (
      <div className="flex items-center gap-3 border-b py-3 last:border-b-0">
        <span className="shrink-0 text-muted-foreground">
          {kind === 'customer' ? <Users className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{name}</div>
          <div className="truncate text-sm text-muted-foreground">
            {[sub, carries || 'no history'].filter(Boolean).join(' — ')}
          </div>
        </div>
        {removedAt && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline" title={format(new Date(removedAt), 'PPpp')}>
            {formatDistanceToNow(new Date(removedAt), { addSuffix: true })}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(id);
            try {
              if (kind === 'customer') await restoreCustomer(id);
              else await restoreKarigar(id);
              toast({ title: 'Put back', description: `${name} is in the book again.` });
            } catch {
              toast({ title: 'Could not restore', variant: 'destructive' });
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === id ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-2 h-3 w-3" />}
          Put back
        </Button>
      </div>
    );
  };

  return (
    <PageShell
      title="Recently removed"
      subtitle="Nothing here has been destroyed. Their history is exactly where they left it."
      icon={<RotateCcw className="h-6 w-6" />}
      width="narrow"
      action={<PageBack fallback="/settings" />}
    >

      {total === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nobody has been removed.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{total} removed</CardTitle>
                <CardDescription>
                  {removedCustomers.length} customer(s), {removedKarigars.length} karigar(s)
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy !== null} onClick={restoreAll}>
                  {busy === 'all' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  Put everything back
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={busy !== null}>
                      <Trash2 className="mr-2 h-4 w-4" /> Empty
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Empty Recently removed?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes {removedCustomers.length} customer(s) and{' '}
                        {removedKarigars.length} karigar(s).
                        {(totalEntries > 0 || totalOrders > 0) && (
                          <> They carry {totalEntries} ledger entr{totalEntries === 1 ? 'y' : 'ies'} and{' '}
                          {totalOrders} order{totalOrders === 1 ? '' : 's'} between them, which will be
                          orphaned.</>
                        )}{' '}
                        This is the one thing in the app that cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep them</AlertDialogCancel>
                      <AlertDialogAction onClick={empty} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Delete permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardHeader>
          </Card>

          {removedCustomers.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Customers</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {removedCustomers.map((c) => (
                  <Row key={c.id} id={c.id} name={c.name} sub={c.phone} removedAt={c.deletedAt} kind="customer" />
                ))}
              </CardContent>
            </Card>
          )}

          {removedKarigars.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Karigars</CardTitle></CardHeader>
              <CardContent className="pt-0">
                {removedKarigars.map((k) => (
                  <Row key={k.id} id={k.id} name={k.name} sub={k.contact} removedAt={k.deletedAt} kind="karigar" />
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
