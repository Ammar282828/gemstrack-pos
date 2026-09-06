"use client";

/**
 * Bringing contacts in from a phone.
 *
 * Export the address book (on iPhone: Contacts → select all → Share → Save to Files) and
 * choose the .vcf. Only entries marked TJ, HOM, TC or Karigar in the name are taken —
 * everything else is a personal contact and is ignored.
 *
 * Nothing is written until Import is pressed. The screen first shows what WOULD happen,
 * and the half-matches are the point of it: same name with a different number is usually
 * one person with a second phone; same number with a different name is usually the same
 * person written more fully. Both are questions, and neither is safe to answer silently.
 */

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import {
  planImport, toExistingRows, defaultChoice,
  type Conflict, type ConflictChoice, type ImportPlan, type PendingContact,
} from '@/lib/contacts/triage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Briefcase, Check, FileUp, HelpCircle, Import, Loader2, Users, X,
} from 'lucide-react';
import { PageShell } from '@/components/shared/page-shell';
import { PageBack } from '@/components/shared/page-back';

export default function ContactImportPage() {
  const router = useRouter();
  const { toast } = useToast();

  const customers = useAppStore((s) => s.customers);
  const karigars = useAppStore((s) => s.karigars);
  const addCustomer = useAppStore((s) => s.addCustomer);
  const addKarigar = useAppStore((s) => s.addKarigar);
  const updateCustomer = useAppStore((s) => s.updateCustomer);
  const updateKarigar = useAppStore((s) => s.updateKarigar);

  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [importing, setImporting] = useState(false);

  const existing = useMemo(() => toExistingRows(customers, karigars), [customers, karigars]);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setPlan(null);
    setDropped(new Set());
    setFileName(file.name);
    try {
      const text = await file.text();
      if (!text.includes('BEGIN:VCARD')) {
        setError('That does not look like a contacts file. Export a .vcf from your phone.');
        return;
      }
      const next = planImport(text, existing);
      setPlan(next);
      setChoices(Object.fromEntries(next.conflicts.map((c) => [c.id, defaultChoice(c.reason)])));
    } catch {
      setError('Could not read that file.');
    }
  };

  const willAdd = plan ? plan.fresh.filter((f) => !dropped.has(f.id)).length : 0;
  const willResolve = plan
    ? plan.conflicts.filter((c) => choices[c.id] && choices[c.id] !== 'skip').length
    : 0;

  const runImport = async () => {
    if (!plan) return;
    setImporting(true);
    let added = 0;
    let updated = 0;
    try {
      for (const f of plan.fresh) {
        if (dropped.has(f.id)) continue;
        await create(f);
        added++;
      }

      for (const c of plan.conflicts) {
        const choice = choices[c.id];
        if (!choice || choice === 'skip') continue;
        if (choice === 'add_separately') {
          await create(c);
          added++;
          continue;
        }
        const target = c.matches[0];
        if (choice === 'add_phone' && c.phone) {
          // The spare slot only. The number already in the book keeps its place.
          const patch = { altPhone: c.phone };
          if (target.kind === 'customer') await updateCustomer(target.id, patch);
          else await updateKarigar(target.id, patch);
          updated++;
        } else if (choice === 'adopt_name') {
          if (target.kind === 'customer') await updateCustomer(target.id, { name: c.name });
          else await updateKarigar(target.id, { name: c.name });
          updated++;
        }
      }

      toast({
        title: 'Import finished',
        description: `${added} added, ${updated} updated. ${plan.settled.length} were already saved.`,
      });
      setPlan(null);
      setFileName('');
    } catch (err) {
      toast({
        title: 'Import stopped',
        description: err instanceof Error ? err.message : 'Some contacts may already be in.',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  async function create(c: PendingContact) {
    if (c.kind === 'karigar') {
      await addKarigar({
        name: c.name,
        contact: c.phone ?? undefined,
        altPhone: c.extraPhones[0],
      });
      return;
    }
    await addCustomer({
      name: c.name,
      phone: c.phone ?? undefined,
      altPhone: c.extraPhones[0],
      tags: c.tags.length ? c.tags : undefined,
    });
  }

  return (
    <PageShell
      title="Import contacts"
      subtitle="From a phone's address book. Nothing is written until you press Import."
      icon={<FileUp className="h-6 w-6" />}
      action={<PageBack fallback="/settings" />}
    >

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Choose the file</CardTitle>
          <CardDescription>
            On iPhone: Contacts → select all → Share → Save to Files. Only entries marked{' '}
            <strong>TJ</strong>, <strong>HOM</strong>, <strong>TC</strong> or{' '}
            <strong>Karigar</strong> in the name are taken. The mark is stripped, so
            &ldquo;Altaf TJ&rdquo; is saved as <strong>Altaf</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 hover:bg-accent/50">
            <FileUp className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm">{fileName || 'Choose a .vcf file'}</span>
            <input type="file" accept=".vcf,.vcard,text/vcard" className="hidden" onChange={onFile} />
          </label>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Could not read that</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {plan && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What would happen</CardTitle>
              <CardDescription>
                {plan.summary.cardsInFile} contacts in the file · {plan.summary.ignoredUntagged}{' '}
                personal contacts ignored
                {plan.summary.mergedDuplicates > 0 && ` · ${plan.summary.mergedDuplicates} duplicate(s) merged`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">{plan.summary.settled}</div>
                <div className="text-xs text-muted-foreground">Already saved</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">{willAdd}</div>
                <div className="text-xs text-muted-foreground">New</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-2xl font-semibold">{plan.summary.conflicts}</div>
                <div className="text-xs text-muted-foreground">Needs you</div>
              </div>
            </CardContent>
          </Card>

          {plan.conflicts.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <HelpCircle className="h-4 w-4" />Needs you
                </CardTitle>
                <CardDescription>
                  Half-matches — the only kind that can go wrong. Anything you leave alone
                  stays exactly as it is in the book.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {plan.conflicts.map((c) => (
                  <ConflictRow
                    key={c.id}
                    conflict={c}
                    choice={choices[c.id]}
                    onChoose={(v) => setChoices((prev) => ({ ...prev, [c.id]: v }))}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {plan.fresh.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">New</CardTitle>
                <CardDescription>
                  Nothing in the book matches these. Drop any you do not want.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="max-h-[340px] pr-2">
                  {plan.fresh.map((f) => {
                    const off = dropped.has(f.id);
                    return (
                      <div
                        key={f.id}
                        className={`flex items-center gap-3 border-b py-2 last:border-b-0 ${off ? 'opacity-40' : ''}`}
                      >
                        <span className="shrink-0 text-muted-foreground">
                          {f.kind === 'customer' ? <Users className="h-4 w-4" /> : <Briefcase className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className={`truncate text-sm font-medium ${off ? 'line-through' : ''}`}>{f.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {f.phone ?? 'no number'}
                            {f.extraPhones.length > 0 && ` (+${f.extraPhones.length} more)`}
                          </div>
                        </div>
                        {f.tags.map((t) => (
                          <Badge key={t} variant="secondary" className="uppercase">{t}</Badge>
                        ))}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDropped((prev) => {
                            const next = new Set(prev);
                            if (next.has(f.id)) next.delete(f.id); else next.add(f.id);
                            return next;
                          })}
                        >
                          {off ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                          <span className="sr-only">{off ? 'Put back' : 'Drop'}</span>
                        </Button>
                      </div>
                    );
                  })}
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {plan.settled.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Already saved</CardTitle>
                <CardDescription>
                  Name and number both match somebody you have. Skipped, no question asked.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground">
                  {plan.settled.slice(0, 30).map((s) => s.name).join(', ')}
                  {plan.settled.length > 30 && ` and ${plan.settled.length - 30} more`}
                </p>
              </CardContent>
            </Card>
          )}

          <div className="sticky bottom-20 flex items-center justify-between gap-3 rounded-lg border bg-background p-3 shadow-lg md:bottom-4">
            <p className="text-sm text-muted-foreground">
              {willAdd} to add, {willResolve} to resolve.
            </p>
            <Button onClick={runImport} disabled={importing || (willAdd === 0 && willResolve === 0)}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Import className="mr-2 h-4 w-4" />}
              Import
            </Button>
          </div>
        </>
      )}
    </PageShell>
  );
}

function ConflictRow({
  conflict, choice, onChoose,
}: { conflict: Conflict; choice: ConflictChoice; onChoose: (v: ConflictChoice) => void }) {
  const target = conflict.matches[0];
  const sameName = conflict.reason === 'same_name';

  const options: Array<{ value: ConflictChoice; label: string; hint: string }> = sameName
    ? [
        { value: 'add_phone', label: 'Same person, second phone', hint: 'Adds the number to the spare slot' },
        { value: 'add_separately', label: 'Different people', hint: 'Adds this one separately' },
        { value: 'skip', label: 'Leave the book alone', hint: 'Nothing changes' },
      ]
    : [
        { value: 'adopt_name', label: 'Same person, fuller name', hint: `Renames to “${conflict.name}”` },
        { value: 'add_separately', label: 'Different people', hint: 'Adds this one separately' },
        { value: 'skip', label: 'Leave the book alone', hint: 'Nothing changes' },
      ];

  return (
    <div className="rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">In the book</div>
          <div className="text-sm font-medium">{target.name}</div>
          <div className="text-xs text-muted-foreground">
            {[target.phone, target.altPhone].filter(Boolean).join(' · ') || 'no number'}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">On the phone</div>
          <div className="text-sm font-medium">{conflict.name}</div>
          <div className="text-xs text-muted-foreground">{conflict.phone ?? 'no number'}</div>
        </div>
      </div>
      <Separator className="my-3" />
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={o.value}
            size="sm"
            variant={choice === o.value ? 'default' : 'outline'}
            onClick={() => onChoose(o.value)}
            title={o.hint}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
