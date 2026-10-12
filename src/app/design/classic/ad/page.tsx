'use client';

/**
 * The classic ad maker (/design/classic/ad): the Ad studio's Make, Photos and Saved as they were before the
 * cutover to Design (docs/features/design.md). Design covers the ad itself — sizes, layouts, words, the check, the
 * Meta hand-off, Saved — but not yet "Make it with AI" (an art-directed layout, a painted ad) or the lettering
 * pass, which live only here. It is not in the menu; Design's start screen links to it.
 *
 * Plan, Board and the competitors moved: Ads → Plan, Design › Board.
 */

import React, { Suspense, useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageShell } from '@/components/shared/page-shell';
import { Star, Images, Brush, PlugZap, FolderOpen, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { useAdsStatus } from '../../../ads/ads-kit';
import { AssetSheet, LibrarySection, PicksSection, usePlacement } from '../../library';
import { Maker } from './maker';
import { SavedSection, type SavedRestore } from './saved';
import type { LibraryItem, WorkPhoto } from '../../studio-kit';

const VIEWS = [
  { key: 'photos', label: 'Photos', icon: Images },
  { key: 'make', label: 'Make', icon: Brush },
  { key: 'saved', label: 'Saved', icon: FolderOpen },
] as const;
type View = typeof VIEWS[number]['key'];
const PARTS = [{ key: 'picks', label: 'Best for ads', icon: Star }, { key: 'library', label: 'Every photo', icon: Images }] as const;

export default function ClassicAdRoute() {
  if (!STORE_AD_STUDIO) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">The ad maker isn’t part of this shop.</p>;
  return <Suspense><ClassicAd /></Suspense>;
}

function ClassicAd() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const asked = params.get('v') || '';
  const v = (VIEWS.some(x => x.key === asked) ? asked : 'photos') as View;
  const part = PARTS.some(x => x.key === params.get('s')) ? params.get('s')! : 'picks';
  const go = useCallback((next: View, s?: string) => router.replace(`${pathname}?v=${next}${s ? `&s=${s}` : ''}`, { scroll: false }), [router, pathname]);
  const [placement, setPlacement] = usePlacement();
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [work, setWork] = useState<WorkPhoto | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [restore, setRestore] = useState<SavedRestore | null>(null);
  const { status, ready } = useAdsStatus();

  const make = (w: WorkPhoto) => { setWork(w); setOpen(null); go('make'); };
  const reopen = (r: SavedRestore) => { setRestore(r); setWork(r.work); go('make'); };

  return (
    <PageShell title="Ad maker (classic)" icon={<Brush className="h-6 w-6" />} width="wide">
      <Link href="/design?v=make&kind=ad" className="inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft className="h-4 w-4" /> Back to Design</Link>
      <nav className="tabs-list flex gap-1 overflow-x-auto rounded-full border p-1 w-fit max-w-full" aria-label="Ad maker">
        {VIEWS.map(x => (
          <button key={x.key} type="button" onClick={() => go(x.key)} aria-current={v === x.key ? 'page' : undefined}
            className={cn('tabs-trigger inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap min-h-0', v === x.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
            <x.icon className="h-4 w-4" /> {x.label}
          </button>
        ))}
      </nav>
      {v === 'photos' && (
        <nav className="flex gap-1.5 overflow-x-auto" aria-label="Photos sections">
          {PARTS.map(x => (
            <button key={x.key} type="button" onClick={() => go(v, x.key)} aria-current={part === x.key ? 'true' : undefined}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs whitespace-nowrap min-h-0', part === x.key ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              <x.icon className="h-3.5 w-3.5" /> {x.label}
            </button>
          ))}
        </nav>
      )}
      {status && !ready && v === 'make' && (
        <p className="text-xs rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 flex items-center gap-2">
          <PlugZap className="h-4 w-4 shrink-0" />
          <span>Meta isn’t set up — <Link href="/ads/setup" className="text-primary underline">Setup</Link>.</span>
        </p>
      )}
      {v === 'photos' && part === 'picks' && <PicksSection placement={placement} onPlacement={setPlacement} onOpen={setOpen} reloadKey={reloadKey} />}
      {v === 'photos' && part === 'library' && <LibrarySection placement={placement} onPlacement={setPlacement} onOpen={setOpen} reloadKey={reloadKey} />}
      {v === 'make' && <Maker work={work} onChoose={() => go('photos', 'picks')} onUpload={setWork} play={null} restore={restore} />}
      {v === 'saved' && <SavedSection onOpen={reopen} />}

      <AssetSheet item={open} placement={placement} onClose={() => setOpen(null)} onMake={make} onChanged={() => setReloadKey(n => n + 1)} />
    </PageShell>
  );
}
