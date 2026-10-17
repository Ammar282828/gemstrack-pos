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

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageShell } from '@/components/shared/page-shell';
import { Loader2 } from 'lucide-react';
import { ChipRow, FilterChip } from '@/components/ledger';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { listPostDrafts } from '@/lib/social/post-drafts';
import { PLAYS } from '@/lib/ads/studio/plays';
import type { SitePick } from '../website/post/site-picker';
import { authHeaders } from '../ads/ads-kit';
import { STORE_DESIGN } from '@/lib/store-config';
import { DESIGN_KINDS, type DesignKind, type DesignRecord } from '@/lib/design/model';
import { BoardSection } from './board';
import { PhotosSection } from './photos-section';
import { SavedShelf } from './saved-shelf';
import { StartScreen, startPhotoFromSite } from './start';
import { DesignWorkspace } from './workspace';
import { displayName, isDesignDraft, kindCard, photoPartOf, sectionOf, sectionsFor, type PhotoPart, type SectionKey } from './design-state';
import { OldDraftView } from './old-draft-view';
import { diagnose } from '@/lib/social/diagnose';
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
  const { toast } = useToast();
  /** The photograph chosen for the next design: kept while the person looks in Photos and comes back. */
  const [photo, setPhoto] = useState<StartPhoto | null>(null);

  const v = sectionOf(params.get('v'), adsOk);
  const part = photoPartOf(params.get('s'), adsOk);
  const askedKind = params.get('kind');
  const initialKind: DesignKind | undefined = DESIGN_KINDS.find(k => k === askedKind);
  const go = useCallback((next: SectionKey, s?: PhotoPart) => router.replace(`${pathname}?v=${next}${s ? `&s=${s}` : ''}`, { scroll: false }), [router, pathname]);

  // A draft of the older Post a piece screen opens as a design; one that can't is shown read-only.
  const [oldView, setOldView] = useState<string | null>(null);
  const openAnyDraft = useCallback(async (id: string): Promise<boolean> => {
    const d = (await listPostDrafts().catch(() => [])).find(x => x.id === id);
    if (!d) { toast({ title: 'That draft could not be opened', description: 'It may have been cleared from this device.', variant: 'destructive' }); return false; }
    if (isDesignDraft(d.state)) { await design.openDraft(id); return true; }
    const r = await design.openOldDraft(id);
    if (!r.ok) { setOldView(id); return false; }
    toast({
      title: 'Opened as a design',
      description: r.partlySent ? 'Part of this piece had already been sent from the older screen. The Publish sheet does not know that: check before sending again.' : 'Your words, photographs and both pictures came with it.',
      ...(r.partlySent ? { variant: 'destructive' as const } : {}),
    });
    return true;
  }, [design, toast]);

  // Back from Instagram's approval page.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const got = q.get('instagram');
    if (!got) return;
    if (got === 'connected') toast({ title: `Instagram connected as @${q.get('username')}`, description: 'Stories and posts now go straight from here.' });
    if (got === 'error') { const d = diagnose('instagram-connect', q.get('reason') || ''); toast({ title: `Instagram was not connected — ${d.title.toLowerCase()}`, description: d.fix, variant: 'destructive' }); }
    ['instagram', 'username', 'reason'].forEach(k => q.delete(k));
    window.history.replaceState(null, '', `${window.location.pathname}${q.toString() ? `?${q}` : ''}`);
  }, [toast]);

  const askedPlay = params.get('play');
  const play = PLAYS.find(p => p.id === askedPlay) ?? null;
  const clearPlay = () => { if (askedPlay) router.replace(`${pathname}?v=make&kind=ad`, { scroll: false }); };

  // The old Post a piece addresses: ?draft=<id>, ?site=<id>, ?new=1 (the Posts hub, Edit a piece, bookmarks). Each is
  // answered once and then taken off the address, so a reload keeps the design on the page, not the request.
  const askedDraft = params.get('draft');
  const askedSite = params.get('site');
  const askedNew = params.has('new');
  const answered = useRef('');
  const answer = useCallback(async () => {
    const strip = () => { const q = new URLSearchParams(window.location.search); ['draft', 'site', 'new'].forEach(k => q.delete(k)); if (!q.get('v')) q.set('v', 'make'); router.replace(`${pathname}?${q}`, { scroll: false }); };
    try {
      if (askedDraft) {
        await openAnyDraft(askedDraft);
      } else if (askedSite) {
        const res = await fetch('/api/website/site-pieces', { headers: await authHeaders(), cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        const piece = ((body.pieces ?? []) as SitePick[]).find(x => x.id === askedSite);
        if (!res.ok || !piece) throw new Error(body.error || 'That piece is no longer on the website.');
        await design.start({ kind: 'piece', sizes: kindCard('piece').sizes.map(id => ({ id })), photo: startPhotoFromSite(piece) });
      } else if (askedNew) {
        design.close();
      }
    } catch (e) {
      toast({ title: 'Couldn’t bring the piece in', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
    strip();
  }, [askedDraft, askedSite, askedNew, design, openAnyDraft, pathname, router, toast]);
  useEffect(() => {
    if (!askedDraft && !askedSite && !askedNew) return;
    const key = `${askedDraft}|${askedSite}|${askedNew}`;
    if (answered.current === key) return;
    answered.current = key;
    void answer();
  }, [askedDraft, askedSite, askedNew, answer]);

  const start = async (req: StartRequest) => { if (await design.start(req)) { setPhoto(null); go('make'); } };
  const openSaved = async (r: DesignRecord) => { await design.openRecord(r); go('make'); };
  const openDraft = async (id: string) => { if (await openAnyDraft(id)) go('make'); };

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
          : <StartScreen adsOk={adsOk} initialKind={initialKind} play={play} onClearPlay={clearPlay} photo={photo} onPhoto={setPhoto} onStart={start} starting={design.starting}
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
      <OldDraftView id={oldView} onClose={() => setOldView(null)} />
    </PageShell>
  );
}
