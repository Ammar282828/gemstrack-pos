'use client';

/**
 * Ads → Studio (Taheri only for now; the owner, 2026-09-29: "a curated ad analysis
 * guide + maker + competitor searcher + builder … assessing all images from
 * taheri.shop and from my google drive … to recommend, fix, assess and build + help
 * create like in canva ad creatives").
 *
 *   Plan         the plays: what to run for each place a buyer lands (plays.ts), "Make this" → the maker set up for it
 *   Picks        the best photographs for the chosen placement, as ranked from each one's assessment
 *   Library      every photo from taheri.shop and the shared Drive folders, searchable, with its score
 *   Make         the maker: Taheri's ad layouts at Meta's sizes, AI words, a pre-flight check, → New ad
 *   Competitors  found by Google Search, looked up on Instagram, read for what works
 *   Guide        the days ads stay off, what the account's own winners share, the playbook, the rules
 *
 * One Ads tab; the sections are `?v=` so a section can be linked and survives a reload.
 */

import React, { Suspense, useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageShell } from '@/components/shared/page-shell';
import { Palette, Star, Images, Brush, Swords, BookOpen, PlugZap, Map as MapIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { useAdsStatus } from '../ads-kit';
import { AssetSheet, LibrarySection, PicksSection, usePlacement } from './library';
import { Maker } from './maker';
import { RivalsSection } from './rivals';
import { GuideSection } from './guide';
import { PlanSection } from './plan';
import type { Play } from '@/lib/ads/studio/plays';
import type { LibraryItem, WorkPhoto } from './studio-kit';

const VIEWS = [
  { key: 'plan', label: 'Plan', icon: MapIcon },
  { key: 'picks', label: 'Picks', icon: Star },
  { key: 'library', label: 'Library', icon: Images },
  { key: 'make', label: 'Make', icon: Brush },
  { key: 'rivals', label: 'Competitors', icon: Swords },
  { key: 'guide', label: 'Guide', icon: BookOpen },
] as const;
type View = typeof VIEWS[number]['key'];

export default function AdStudioRoute() {
  if (!STORE_AD_STUDIO) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">The Ad studio isn’t part of this shop.</p>;
  return <Suspense><AdStudio /></Suspense>;
}

function AdStudio() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const v = (VIEWS.some(x => x.key === params.get('v')) ? params.get('v') : 'plan') as View;
  const go = useCallback((next: View) => router.replace(`${pathname}?v=${next}`, { scroll: false }), [router, pathname]);
  const [placement, setPlacement] = usePlacement();
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [work, setWork] = useState<WorkPhoto | null>(null);
  /** The play being made, from the Plan tab: the maker opens set up for it. */
  const [play, setPlay] = useState<Play | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { status, ready } = useAdsStatus();
  const connected = !!status?.connection?.connected;

  const make = (w: WorkPhoto) => { setWork(w); setOpen(null); go('make'); };
  const startPlay = (p: Play) => { setPlay(p); go(work ? 'make' : 'picks'); };

  return (
    <PageShell title="Ad studio" icon={<Palette className="h-6 w-6" />} width="wide"
      subtitle="Every photo from taheri.shop and your Drive, assessed as an ad — fixed, laid out in the house’s dress, checked, and sent to a new ad.">
      <nav className="tabs-list flex gap-1 overflow-x-auto rounded-full border p-1 w-fit max-w-full" aria-label="Studio">
        {VIEWS.map(x => (
          <button key={x.key} type="button" onClick={() => go(x.key)} aria-current={v === x.key ? 'page' : undefined}
            className={cn('tabs-trigger inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap min-h-0', v === x.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            <x.icon className="h-4 w-4" /> {x.label}
          </button>
        ))}
      </nav>
      {status && !ready && (v === 'make' || v === 'rivals') && (
        <p className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 flex items-center gap-2">
          <PlugZap className="h-4 w-4 shrink-0" />
          <span>Meta isn’t fully set up — designing works, but sending to a new ad{v === 'rivals' ? ' and looking competitors up on Instagram need' : ' needs'} <Link href="/ads/setup" className="text-primary underline">Ads → Setup</Link>.</span>
        </p>
      )}

      {play && v !== 'plan' && (
        <p className="text-xs rounded-lg border border-primary/40 bg-primary/5 p-2.5 flex items-center gap-2">
          <MapIcon className="h-4 w-4 shrink-0 text-primary" />
          <span className="flex-1">{v === 'make' ? <>Making <b>{play.title}</b> — goes to {play.where.toLowerCase()}.</> : <>Choose a photo for <b>{play.title}</b>, then “Make an ad with it”.</>}</span>
          <button type="button" className="p-1 min-h-0 text-muted-foreground" onClick={() => setPlay(null)} aria-label="Not this play"><X className="h-4 w-4" /></button>
        </p>
      )}
      {v === 'plan' && <PlanSection onMake={startPlay} hasPhoto={!!work} />}
      {v === 'picks' && <PicksSection placement={placement} onPlacement={setPlacement} onOpen={setOpen} reloadKey={reloadKey} />}
      {v === 'library' && <LibrarySection placement={placement} onPlacement={setPlacement} onOpen={setOpen} reloadKey={reloadKey} />}
      {v === 'make' && <Maker work={work} onChoose={() => go('picks')} onUpload={setWork} play={play} />}
      {v === 'rivals' && <RivalsSection connected={connected} />}
      {v === 'guide' && <GuideSection connected={ready} />}

      <AssetSheet item={open} placement={placement} onClose={() => setOpen(null)} onMake={make} onChanged={() => setReloadKey(n => n + 1)} />
    </PageShell>
  );
}
