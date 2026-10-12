'use client';

/**
 * Ads → Plan: what to run and why. It was the Plan half of Ads → Studio; the design half (Photos, Make, Board,
 * Saved) is Design now (docs/features/design.md), and "Make this" opens Design on an ad set up for the play.
 *
 *   What to run      the plays by funnel stage (plays.ts)
 *   Ad days & rules  the Bohra calendar's quiet days, the account's own winners, the house's rules (Guide)
 *   Competitors      the rivals the model finds, and Instagram's Business Discovery
 *
 * The sections are `?s=` so one can be linked and survives a reload. Old `/ads/studio?v=plan|guide|rivals` land here
 * (lib/design/redirects.ts).
 */

import React, { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageShell } from '@/components/shared/page-shell';
import { Map as MapIcon, BookOpen, Swords, PlugZap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { useAdsStatus } from '../ads-kit';
import { PlanSection } from './plan';
import { GuideSection } from './guide';
import { RivalsSection } from './rivals';
import type { Play } from '@/lib/ads/studio/plays';

const PARTS = [
  { key: 'plays', label: 'What to run', icon: MapIcon },
  { key: 'guide', label: 'Ad days & rules', icon: BookOpen },
  { key: 'rivals', label: 'Competitors', icon: Swords },
] as const;

export default function AdsPlanRoute() {
  if (!STORE_AD_STUDIO) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">The Plan isn’t part of this shop.</p>;
  return <Suspense><AdsPlan /></Suspense>;
}

function AdsPlan() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asked = params.get('s');
  const part = PARTS.some(x => x.key === asked) ? asked! : 'plays';
  const go = useCallback((s: string) => router.replace(`${pathname}?s=${s}`, { scroll: false }), [router, pathname]);
  const { status, ready } = useAdsStatus();
  const connected = !!status?.connection?.connected;
  const make = (p: Play) => router.push(`/design?v=make&kind=ad&play=${encodeURIComponent(p.id)}`);

  return (
    <PageShell title="Plan" icon={<MapIcon className="h-6 w-6" />} width="wide">
      <nav className="flex gap-1.5 overflow-x-auto" aria-label="Plan sections">
        {PARTS.map(x => (
          <button key={x.key} type="button" onClick={() => go(x.key)} aria-current={part === x.key ? 'true' : undefined}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs whitespace-nowrap min-h-0', part === x.key ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            <x.icon className="h-3.5 w-3.5" /> {x.label}
          </button>
        ))}
      </nav>
      {status && !ready && part === 'rivals' && (
        <p className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 flex items-center gap-2">
          <PlugZap className="h-4 w-4 shrink-0" />
          <span>Meta isn’t set up — <Link href="/ads/setup" className="text-primary underline">Setup</Link>.</span>
        </p>
      )}
      {part === 'plays' && <PlanSection onMake={make} />}
      {part === 'guide' && <GuideSection connected={ready} />}
      {part === 'rivals' && <RivalsSection connected={connected} />}
    </PageShell>
  );
}
