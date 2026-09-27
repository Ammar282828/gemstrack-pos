'use client';

/**
 * Drafts — orders and sales started and not yet saved, on every device (owner, 2026-09-27:
 * "drafts should have a separate section (order/invoice drafts) and be saved there").
 * Nothing that already exists is ever here: see lib/work-drafts.ts.
 */

import React from 'react';
import Link from 'next/link';
import { ClipboardList, FileClock, PlusCircle, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/shared/skeletons';
import { DraftCard } from '@/components/drafts/draft-list';
import { useWorkDrafts } from '@/components/drafts/use-work-drafts';
import { DRAFT_MAX_AGE_DAYS } from '@/lib/work-drafts';

export default function DraftsPage() {
  const { drafts, ready } = useWorkDrafts();
  const orders = drafts.filter(d => d.kind === 'order');
  const sales = drafts.filter(d => d.kind === 'sale');

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-5 md:py-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold text-primary md:text-3xl"><FileClock className="h-7 w-7 flex-shrink-0" />Drafts</h1>
        <p className="text-sm text-muted-foreground">
          New orders and sales, kept as they are typed — on every device. One leaves this list the moment it is saved as an
          order or invoice, and after {DRAFT_MAX_AGE_DAYS} days untouched. Orders and invoices that already exist are never drafted.
        </p>
      </header>

      {!ready ? <ListSkeleton /> : (
        <>
          <Section title="Orders" icon={<ClipboardList className="h-4 w-4" />} empty="No unfinished orders."
            action={<Button asChild size="sm" variant="outline"><Link href="/orders/add"><PlusCircle className="mr-1.5 h-4 w-4" />New order</Link></Button>}>
            {orders.map(d => <DraftCard key={d.id} d={d} />)}
          </Section>
          <Section title="Sales" icon={<Receipt className="h-4 w-4" />} empty="No unfinished sales."
            action={<Button asChild size="sm" variant="outline"><Link href="/cart"><PlusCircle className="mr-1.5 h-4 w-4" />New sale</Link></Button>}>
            {sales.map(d => <DraftCard key={d.id} d={d} />)}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, icon, empty, action, children }: { title: string; icon: React.ReactNode; empty: string; action: React.ReactNode; children: React.ReactNode[] }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">{icon}{title}{children.length > 0 && <span className="text-sm font-normal text-muted-foreground">{children.length}</span>}</h2>
        {action}
      </div>
      {children.length ? children : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}
