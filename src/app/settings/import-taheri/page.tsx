"use client";

/**
 * Settings → Import the Taheri Software book.
 *
 * A one-off migration from the shop's previous SQLite app. It runs here rather than as a
 * script on purpose: the writes go through this app's own store actions as the signed-in
 * owner, so they obey the same Firestore rules and land in the activity log like anything
 * else. A script would need admin credentials and would bypass both.
 *
 * Nothing is written until Import is pressed, and half-matches are shown rather than
 * merged. This runs against the live book — a silent merge here joins somebody's account
 * to a stranger's.
 */

import React, { useMemo, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { planBookImport, type BookPlan, type Planned, type IncomingCustomer, type IncomingKarigar, type TaheriBook } from '@/lib/import/taheri-book';
import bookJson from '@/lib/import/taheri-book.json';
import { PageShell } from '@/components/shared/page-shell';
import { PageBack } from '@/components/shared/page-back';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Briefcase, Database, Loader2, TriangleAlert, Users } from 'lucide-react';

const book = bookJson as TaheriBook;

export default function ImportTaheriPage() {
  const { toast } = useToast();
  const customers = useAppStore((s) => s.customers);
  const karigars = useAppStore((s) => s.karigars);
  const addCustomer = useAppStore((s) => s.addCustomer);
  const addKarigar = useAppStore((s) => s.addKarigar);
  const loadCustomers = useAppStore((s) => s.loadCustomers);
  const loadKarigars = useAppStore((s) => s.loadKarigars);
  const hisaabEntries = useAppStore((s) => s.hisaabEntries);
  const loadHisaab = useAppStore((s) => s.loadHisaab);

  React.useEffect(() => {
    loadCustomers(); loadKarigars(); loadHisaab();
  }, [loadCustomers, loadKarigars, loadHisaab]);

  /**
   * How much ledger already hangs off each existing record.
   *
   * This is the number that decides a half-match. The karigars already here carry the
   * shop's whole gold and labour history; adding a second copy of one splits that history
   * across two names, and the copy holding it is not the one anybody will pick from a
   * dropdown afterwards.
   */
  const ledgerCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of hisaabEntries) m.set(e.entityId, (m.get(e.entityId) ?? 0) + 1);
    return m;
  }, [hisaabEntries]);

  /** Half-matches are opt-IN. The safe default is to leave the live book alone. */
  const [takeConflicts, setTakeConflicts] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ customers: number; karigars: number } | null>(null);

  const plan: BookPlan = useMemo(
    () => planBookImport(book, customers, karigars),
    [customers, karigars],
  );

  const c = plan.counts;
  const willAdd = c.customersNew + c.karigarsNew
    + (takeConflicts ? c.customersConflict + c.karigarsConflict : 0);

  const wanted = <T,>(rows: Planned<T>[]) =>
    rows.filter((r) => r.verdict === 'new' || (takeConflicts && r.verdict !== 'settled'));

  const run = async () => {
    setRunning(true);
    let addedC = 0;
    let addedK = 0;
    try {
      for (const row of wanted(plan.customers)) {
        await addCustomer(row.incoming as IncomingCustomer);
        addedC++;
      }
      for (const row of wanted(plan.karigars)) {
        await addKarigar(row.incoming as IncomingKarigar);
        addedK++;
      }
      setDone({ customers: addedC, karigars: addedK });
      toast({ title: 'Import finished', description: `${addedC} customers and ${addedK} karigars added.` });
    } catch (err) {
      toast({
        title: 'Import stopped',
        description: `${addedC} customers and ${addedK} karigars were added before it failed. ${
          err instanceof Error ? err.message : ''
        }`,
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  };

  const Tally = ({ n, label }: { n: number; label: string }) => (
    <div className="rounded-lg border p-3 text-center">
      <div className="text-2xl font-semibold">{n}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );

  const ConflictList = <T extends { name: string }>({ rows, kind }: { rows: Planned<T>[]; kind: string }) => {
    const conflicts = rows.filter((r) => r.verdict !== 'new' && r.verdict !== 'settled');
    if (!conflicts.length) return null;
    return (
      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{kind}</div>
        <ScrollArea className="max-h-[240px] pr-2">
          {conflicts.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b py-2 text-sm last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.incoming.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.verdict === 'same_name' ? 'Same name as' : 'Same number as'}{' '}
                  {r.matches.map((m) => m.name).join(', ')}
                  {(() => {
                    const carried = r.matches.reduce((n, m) => n + (ledgerCount.get(m.id) ?? 0), 0);
                    return carried
                      ? ` — which carries ${carried} ledger entr${carried === 1 ? 'y' : 'ies'}`
                      : '';
                  })()}
                </div>
              </div>
              <Badge variant="outline">{r.verdict === 'same_name' ? 'name' : 'number'}</Badge>
            </div>
          ))}
        </ScrollArea>
      </div>
    );
  };

  return (
    <PageShell
      title="Import the Taheri Software book"
      subtitle={`From ${book.source} — the shop's previous app.`}
      icon={<Database className="h-6 w-6" />}
      action={<PageBack fallback="/settings" />}
    >
      <Alert>
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>This writes to the live book</AlertTitle>
        <AlertDescription>
          These records go into the same database the deployed Taheri app serves. Nothing is
          written until you press Import, and anything already here is skipped.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What is in the file</CardTitle>
          <CardDescription>
            {book.customers.length} customers and {book.karigars.length} karigars. The old app
            kept names, numbers, country and the TJ/HOM/TC tags — it holds no ring sizes,
            birthdays or anniversaries, so those stay empty here too.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" /> Customers
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Tally n={c.customersNew} label="New" />
              <Tally n={c.customersSettled} label="Already here" />
              <Tally n={c.customersConflict} label="Half-matches" />
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Briefcase className="h-4 w-4" /> Karigars
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Tally n={c.karigarsNew} label="New" />
              <Tally n={c.karigarsSettled} label="Already here" />
              <Tally n={c.karigarsConflict} label="Half-matches" />
            </div>
          </div>
        </CardContent>
      </Card>

      {(c.customersConflict > 0 || c.karigarsConflict > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Half-matches</CardTitle>
            <CardDescription>
              The name or the number already exists here, but not both. Usually the same
              person; occasionally two different people who share a name. Left out unless you
              say otherwise.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ConflictList rows={plan.customers} kind="Customers" />
            <ConflictList rows={plan.karigars} kind="Karigars" />
            <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm">
              <Checkbox checked={takeConflicts} onCheckedChange={(v) => setTakeConflicts(Boolean(v))} />
              <span>
                Add these as separate records too.{' '}
                <span className="text-muted-foreground">
                  Creates a second copy where they were the same person. Where the existing
                  record carries a ledger, the copy will not — and the copy is the one that
                  looks newer in a dropdown. Usually the wrong thing; left off by default.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
      )}

      {done ? (
        <Alert>
          <AlertTitle>Imported</AlertTitle>
          <AlertDescription>
            {done.customers} customers and {done.karigars} karigars added. Re-running now adds
            nobody — they all count as already here.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
          <p className="text-sm text-muted-foreground">
            {willAdd} record{willAdd === 1 ? '' : 's'} would be added.
          </p>
          <Button onClick={run} disabled={running || willAdd === 0}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            Import {willAdd}
          </Button>
        </div>
      )}
    </PageShell>
  );
}
