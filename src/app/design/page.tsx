'use client';

/**
 * Design (docs/features/design-studio-plan.md, WP6): one place to make anything — a piece's story and post, an ad,
 * a WhatsApp square, a website photo — and keep it. Hidden from the navigation until the cutover (WP7); reachable
 * at /design. One tab row (the Posts entry's, outside this page); the sections are chips and a `?v=`, so one can
 * be linked and survives a reload:
 *
 *   Make     the start screen, then the workspace (workspace.tsx) once a design is open
 *   Photos   the website's pieces; owner and marketing also the Ad studio's library
 *   Board    the Ad studio's board, mounted in place — owner and marketing
 *   Saved    the shelf: designs in folders, drafts on this device, the ad account
 *
 * Staff keep what `designGate('post')` lets them: no Board, no library, no ad account. The routes refuse the rest
 * too; this only doesn't offer it.
 */

import React, { Suspense, useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageShell } from '@/components/shared/page-shell';
import { Loader2 } from 'lucide-react';
import { ChipRow, FilterChip } from '@/components/ledger';
import { Button } from '@/components/ui/button';
import { STORE_DESIGN } from '@/lib/store-config';
import { DESIGN_KINDS, type DesignKind, type DesignRecord } from '@/lib/design/model';
import { BoardSection } from '../ads/studio/board';
import { PhotosSection } from './photos-section';
import { SavedShelf } from './saved-shelf';
import { StartScreen } from './start';
import { DesignWorkspace } from './workspace';
import { displayName, photoPartOf, sectionOf, sectionsFor, type PhotoPart, type SectionKey } from './design-state';
import { useDesign, useDesignRole, type StartPhoto, type StartRequest } from './use-design';

export default function DesignPage() {
  if (!STORE_DESIGN) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">Design isn’t part of this shop.</p>;
  return <Suspense><DesignRoute /></Suspense>;
}

function DesignRoute() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { adsOk } = useDesignRole();
  const design = useDesign();
  /** The photograph chosen for the next design: kept while the person looks in Photos and comes back. */
  const [photo, setPhoto] = useState<StartPhoto | null>(null);

  const v = sectionOf(params.get('v'), adsOk);
  const part = photoPartOf(params.get('s'), adsOk);
  const askedKind = params.get('kind');
  const initialKind: DesignKind | undefined = DESIGN_KINDS.find(k => k === askedKind);
  const go = useCallback((next: SectionKey, s?: PhotoPart) => router.replace(`${pathname}?v=${next}${s ? `&s=${s}` : ''}`, { scroll: false }), [router, pathname]);

  const start = async (req: StartRequest) => { if (await design.start(req)) { setPhoto(null); go('make'); } };
  const openSaved = async (r: DesignRecord) => { await design.openRecord(r); go('make'); };
  const openDraft = async (id: string) => { await design.openDraft(id); go('make'); };

  const w = design.work;
  return (
    <PageShell title="Design" subtitle={w ? displayName(w) : 'Make it once, send it anywhere'} width="wide">
      <ChipRow label="Design sections">
        {sectionsFor(adsOk).map(s => <FilterChip key={s.key} title={s.label} chosen={v === s.key} onClick={() => go(s.key)} />)}
      </ChipRow>

      {w && v !== 'make' && (
        <p className="flex items-center gap-2 rounded-card bg-card p-3 text-ios-sub">
          <span className="min-w-0 flex-1 truncate">“{displayName(w)}” is open.</span>
          <Button size="sm" onClick={() => go('make')}>Back to it</Button>
        </p>
      )}

      {v === 'make' && (w
        ? <DesignWorkspace design={design} adsOk={adsOk} onAnother={() => go('photos')} onClose={design.close} />
        : design.starting
          ? <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Opening…</p>
          : <StartScreen adsOk={adsOk} initialKind={initialKind} photo={photo} onPhoto={setPhoto} onStart={start} starting={design.starting}
              onChoosePhoto={() => go('photos')} onOpenDraft={openDraft} onOpenSaved={openSaved} onSeeAll={() => go('saved')} />)}

      {v === 'photos' && (
        <PhotosSection adsOk={adsOk} part={part} onPart={p => go('photos', p)}
          onMake={p => {
            // With a design open the photograph goes into it; otherwise it waits on the start screen.
            if (design.work) void p.load().then(b => design.replacePhoto(b, p.label)).then(() => go('make')).catch(() => undefined);
            else { setPhoto(p); go('make'); }
          }} />
      )}
      {v === 'board' && adsOk && <BoardSection />}
      {v === 'saved' && <SavedShelf adsOk={adsOk} onOpen={openSaved} onOpenDraft={openDraft} />}
    </PageShell>
  );
}
