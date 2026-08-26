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
import { Badge } from '@/components/ui/badge';
import {
  Receipt, ClipboardList, ArrowRight, ScanQrCode, ShoppingCart,
} from 'lucide-react';
import { PageBack } from '@/components/shared/page-back';
import { BoardSkeleton } from '@/components/shared/skeletons';
import { UnfinishedWork } from '@/components/shared/unfinished-work';

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

export default function NewSalePage() {
  const appReady = useAppReady();
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <BoardSkeleton tiles={2} panels={2} />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <PageBack fallback="/" label="Back" />
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-primary">New sale</h1>
        <p className="text-muted-foreground mt-1">
          What is this? You can add the pieces once you have picked.
        </p>
      </div>

      {/* A bill left half-finished should be obvious, and one tap from here. */}
      {cartItems.length > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-4 flex items-center gap-3 flex-wrap">
            <ShoppingCart className="h-5 w-5 text-warning flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">You have a bill in progress</p>
              <p className="text-xs text-muted-foreground">
                {cartItems.length} item{cartItems.length === 1 ? '' : 's'} · PKR {cartSubtotal.toLocaleString()}
              </p>
            </div>
            <Button asChild size="sm" className="flex-shrink-0">
              <Link href="/cart">Continue <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <UnfinishedWork />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Choice
          primary
          href="/cart"
          title="Create Invoice"
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
          title="Create Order"
          blurb="A piece to be made, delivered later."
          icon={<ClipboardList className="h-5 w-5" />}
          points={[
            'Describe what is being made, with sizes and instructions',
            'Take an advance now, the balance on delivery',
            'Goes to the workshop and can be assigned to a karigar',
          ]}
        />
      </div>

      {/* Scanning is rare here — most pieces are made to order and never had a
          tag — so it sits below the fold rather than as a headline action. */}
      <div className="flex items-center gap-3 pt-2">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href="/scan"><ScanQrCode className="mr-2 h-4 w-4" />Scan a tagged product</Link>
        </Button>
        <Badge variant="outline" className="text-2xs">for stock you have already tagged</Badge>
      </div>
    </div>
  );
}
