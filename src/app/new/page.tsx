"use client";

/**
 * The one way into a sale.
 *
 * Previously the flow ran the wrong way round: you built a basket first and
 * only at checkout decided whether it was an invoice or an order. The decision
 * is the thing you actually know first — the customer is either paying now or
 * commissioning a piece — and it changes which fields matter. So it is asked
 * first, and each answer continues on the path that already exists.
 */

import React from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Receipt, ClipboardList, ArrowRight, ScanQrCode, ShoppingCart, Wrench, Camera, ScanLine,
} from 'lucide-react';
import { PageShell } from '@/components/shared/page-shell';
import { useWorkDrafts } from '@/components/drafts/use-work-drafts';
import { BoardSkeleton } from '@/components/shared/skeletons';
import { DraftsShortcut } from '@/components/drafts/draft-list';

const Choice: React.FC<{
  href: string;
  title: string;
  blurb: string;
  points: string[];
  icon: React.ReactNode;
  primary?: boolean;
}> = ({ href, title, blurb, points, icon, primary }) => (
  <Link href={href} className="group block">
    <Card className={
      'h-full transition-colors ' +
      (primary ? 'border-primary/40 hover:border-primary' : 'hover:border-primary/40')
    }>
      <CardContent className="p-6 flex flex-col h-full">
        <div className={
          'w-11 h-11 rounded-xl flex items-center justify-center mb-4 ' +
          (primary ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')
        }>
          {icon}
        </div>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{blurb}</p>
        <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground flex-1">
          {points.map(p => (
            <li key={p} className="flex gap-2">
              <span className="text-primary mt-1.5 h-1 w-1 rounded-full bg-primary flex-shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <span className="mt-5 inline-flex items-center text-sm font-medium text-primary">
          Start
          <ArrowRight className="ml-1.5 h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </CardContent>
    </Card>
  </Link>
);

/** This device's unfinished sale (the cart's draft id: gemstrack:sale-draft). */
function useSaleDraftId(): string | null {
  const [id, setId] = React.useState<string | null>(null);
  React.useEffect(() => { try { setId(localStorage.getItem('gemstrack:sale-draft')); } catch { /* private mode */ } }, []);
  return id;
}

export default function NewSalePage() {
  const appReady = useAppReady();
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);
  // The bill in progress is shown once: when Drafts already lists this sale, its card there is the way back.
  const { drafts } = useWorkDrafts('sale');
  const saleDraftId = useSaleDraftId();
  const inDrafts = !!saleDraftId && drafts.some(d => d.id === saleDraftId);

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <BoardSkeleton tiles={3} panels={2} />
      </div>
    );
  }

  return (
    <PageShell width="medium" subtitle="What is this? You add the pieces once you have picked.">
      {/* A bill left half-finished should be obvious, and one tap from here — once. */}
      {cartItems.length > 0 && !inDrafts && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <ShoppingCart className="h-5 w-5 text-warning flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">An invoice in progress</p>
              <p className="text-xs text-muted-foreground">
                {cartItems.length} piece{cartItems.length === 1 ? '' : 's'} · PKR {cartSubtotal.toLocaleString()}
              </p>
            </div>
            <Button asChild size="sm" className="flex-shrink-0">
              <Link href="/cart">Continue <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Orders and sales started and not saved — all of them are in Drafts. */}
      <DraftsShortcut />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Choice
          primary
          href="/cart"
          title="Invoice"
          blurb="The customer is buying now."
          icon={<Receipt className="h-5 w-5" />}
          points={[
            'Add each piece with its details and price',
            'Take payment in full or leave a balance',
            'Prints an invoice and records the sale',
          ]}
        />
        <Choice
          href="/orders/add"
          title="Order"
          blurb="A piece to be made, delivered later."
          icon={<ClipboardList className="h-5 w-5" />}
          points={[
            'Describe what is being made, with sizes and instructions',
            'Take an advance now, the balance on delivery',
            'Goes to the workshop and can be assigned to a karigar',
          ]}
        />
        <Choice
          href="/repairs?new=1"
          title="Repair"
          blurb="A piece brought in to be fixed."
          icon={<Wrench className="h-5 w-5" />}
          points={[
            'One customer, any number of pieces',
            'What to do, a price and a ready-by date',
            'In the shop → Ready → Collected',
          ]}
        />
      </div>

      {/* The other ways in: a tag scanned, or the paper the counter already wrote. */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 pt-1 text-sm">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/scan"><ScanQrCode className="mr-2 h-4 w-4" />Scan a tag</Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/cart?scan=bill"><Camera className="mr-2 h-4 w-4" />Read a written bill</Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/orders/add?scan=parchi"><ScanLine className="mr-2 h-4 w-4" />Scan a parchi</Link>
        </Button>
      </div>
    </PageShell>
  );
}
