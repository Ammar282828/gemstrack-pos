'use client';

/**
 * The state of the design being made (docs/features/design-studio-plan.md WP6): the work (design-state.ts), its
 * one photograph, what is drawn from them, and the three places it lives — the device draft (autosaved every
 * 1.5 s, as post-drafts.ts keeps Post a piece's), the shop's `designs` (Save), and the editor's own undo.
 *
 * Every hook here is called at the top of the component that uses it, before any return; the state is the only
 * thing that changes when a design opens or closes (decisions › Hooks).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/google-auth-gate';
import { devRole } from '@/lib/dev-role';
import { roleForEmail } from '@/lib/roles';
import { useToast } from '@/hooks/use-toast';
import { PALETTES, canvasToJpeg, loadImage, suggestPalette } from '@/lib/social/story';
import { applySquarePreset, reflow, renderDocTo, withPlacement, type Assets, type Fields, type StoryDoc } from '@/lib/social/editor';
import { readImageFile } from './image-file';
import { sizePreset } from '@/lib/design/sizes';
import { PHOTO, applyAdTemplate, blankAd, type AdTemplateId } from '@/lib/ads/studio/templates';
import { ID_OK, fileKey, type DesignRecord, type DesignSource } from '@/lib/design/model';
import {
  deletePostDraft, listPostDrafts, readPostDraft, savePostDraft, thumbOf, type PostDraft,
} from '@/lib/social/post-drafts';
import type { CheckResult } from '@/lib/social/prompts';
import { authHeaders } from '../ads/ads-kit';
import { fetchAsset } from './studio-kit';
import type { SmartPhoto } from './smart-input';
import { FONTS } from '../website/post/fonts';
import { convertOldDraft, isOldPostDraft, type OldDraftState, type OpenedOldDraft } from './old-draft';
import { useSiteAssets } from '../website/post/site-assets';
import {
  addPages, activePage, deserializeWork, displayName, editDoc, fromRecord, isDesignDraft, layOutAll, markSaved, newWork, pageOf, redoFromMaster,
  removePage, serializeWork, setActive, setCopy, setDoc, setFields, setMaster, rename, refile, toInput, toRecordLike,
  type DesignWork, type NewPage, type NewWork, type WorkPage,
} from './design-state';

/** The role as this page needs it. `adsOk`: owner and marketing (the library, the Board, ads). */
export function useDesignRole(): { role: ReturnType<typeof roleForEmail>; adsOk: boolean; email: string } {
  const { user } = useAuth();
  const role = devRole() ?? roleForEmail(user?.email);
  const open = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';
  return { role, adsOk: open || role === 'owner' || role === 'marketing', email: user?.email ?? '' };
}

/** A photograph to start from: fetched when the design opens, so choosing it costs nothing. */
export interface StartPhoto {
  label: string;
  load: () => Promise<Blob>;
  /** The photograph already carries the house's marks (taheri.shop's wordmark and weight). */
  marked?: boolean;
  fields?: Partial<Fields>;
  source?: DesignSource;
}

export interface StartRequest extends Omit<NewWork, 'fields' | 'source'> {
  fields?: Partial<Fields>;
  photo?: StartPhoto | null;
  /** Instead of a template: the document each page starts as (a flat ad rebuilt as layers). Called once the marks are in. */
  compose?: (page: { format: WorkPage['format']; frame: WorkPage['frame'] }) => StoryDoc;
}

/** A photograph the smart input found, as something to start from (its file is already here). */
export function startPhotoOf(p: SmartPhoto): StartPhoto {
  return {
    label: p.from === 'site' ? 'From the website' : p.name || 'Photo',
    load: async () => p.blob,
    ...(p.ref?.startsWith('site:') ? { source: { siteId: p.ref.slice(5) } } : {}),
  };
}

/** A piece of the house's website, at the size the website square is made at. */
export async function fetchSitePhoto(id: string, original = false): Promise<Blob> {
  const q = new URLSearchParams({ id, size: '3000' });
  if (original) q.set('original', '1');
  const res = await fetch(`/api/website/site-pieces/image?${q}`, { headers: await authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The photograph didn’t come (${res.status}).`);
  return res.blob();
}

/** `ai`: the photograph is an AI version of the one before it, with the same-piece check that came with it. */
export interface PhotoState { blob: Blob; img: HTMLImageElement; url: string; label: string; ai?: { check: CheckResult | null } }

/**
 * An AI picture waiting for the person to use it or not: a photograph the same-piece check doubts, or the ad AI's
 * painting (the maker's "Paint the whole ad", which is always looked at first).
 */
export interface AiCandidate {
  kind: 'photo' | 'ad';
  url: string; blob: Blob; label: string;
  /** The result no longer carries the house's marks (the layouts add them back once). */
  clean: boolean;
  check: { samePiece: boolean; confidence?: number; differences: string[] } | null;
  /** The ad painting, read back. */
  lettering?: { ok: boolean; missing: string[]; read: string };
  /** Why it is here to look at. */
  why: 'doubt' | 'paint';
}

/** The dialogs of the AI tools (ai-tools.tsx), open from any panel. */
export type AiDialog = 'setting' | 'ask' | 'paint' | 'make' | null;

const TIDY = 'taheri_design_tidy';

const CURRENT = 'taheri_design_draft';
const newDraftId = () => `design-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const readCurrent = (): string | null => { try { return localStorage.getItem(CURRENT); } catch { return null; } };
const writeCurrent = (id: string | null) => { try { if (id) localStorage.setItem(CURRENT, id); else localStorage.removeItem(CURRENT); } catch { /* private mode */ } };

/** The page made for the website (sizes.ts "Website 1:1"). */
export const isCataloguePage = (p: { label: string }) => p.label === sizePreset('website')?.label;

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Whether a document draws the photograph with this id (as its background or on a picture layer). */
const docUses = (d: StoryDoc, id: string): boolean => d.bg.photoId === id || d.layers.some(l => l.kind === 'image' && !l.src && l.photoId === id);
/** The photographs these documents use besides the main one. */
const otherPhotoIds = (docs: StoryDoc[]): string[] => {
  const ids = new Set<string>();
  for (const d of docs) {
    if (d.bg.photoId) ids.add(d.bg.photoId);
    for (const l of d.layers) if (l.kind === 'image' && !l.src) ids.add(l.photoId);
  }
  ids.delete(PHOTO);
  return [...ids].filter(k => ID_OK.test(k));
};

export function useDesign() {
  const { toast } = useToast();
  const { email } = useDesignRole();
  const [work, setWork] = useState<DesignWork | null>(null);
  const [photo, setPhotoState] = useState<PhotoState | null>(null);
  const [marked, setMarked] = useState(false);
  /** Photographs beyond the main one: an AI-extended copy a resized page uses. */
  const [extra, setExtra] = useState<Record<string, PhotoState>>({});
  // The AI tools: what is running (one at a time — the Vertex quota is tiny), which dialog is open, the photographs
  // before the AI ones (to go back), an AI picture waiting to be looked at, and "also remove tags" (kept per device).
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiDialog, setAiDialog] = useState<AiDialog>(null);
  const [trail, setTrail] = useState<{ blob: Blob; label: string }[]>([]);
  const [candidate, setCandidateState] = useState<AiCandidate | null>(null);
  const [checkTick, setCheckTick] = useState(0);
  const [tidy, setTidyState] = useState(true);
  useEffect(() => { try { if (localStorage.getItem(TIDY) === '0') setTidyState(false); } catch { /* fine */ } }, []);
  const setTidy = useCallback((v: boolean) => { setTidyState(v); try { localStorage.setItem(TIDY, v ? '1' : '0'); } catch { /* fine */ } }, []);
  const setCandidate = useCallback((p: AiCandidate | null) => setCandidateState(prev => { if (prev) URL.revokeObjectURL(prev.url); return p; }), []);
  const pendingOld = useRef<string | null>(null);
  const composeRef = useRef<StartRequest['compose'] | null>(null);
  const [starting, setStarting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState<Date | null>(null);
  const workRef = useRef<DesignWork | null>(null);
  workRef.current = work;
  const draftId = useRef<string | null>(null);
  const storedPhotos = useRef<Set<string>>(new Set());
  const createdAt = useRef<string>(new Date().toISOString());
  const live = !!work;
  const { marks, ready: marksReady } = useSiteAssets(live);

  const assets: Assets = useMemo(() => ({
    photos: { ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v.img])), ...(photo ? { [PHOTO]: photo.img } : {}) } as Assets['photos'],
    marks, fonts: FONTS,
  }), [photo, extra, marks]);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  /** Lettering colours chosen for this photograph (the dark/light of it), as Post a piece did. */
  const palette = useMemo(() => {
    if (!photo) return PALETTES[0];
    try { return suggestPalette(photo.img, { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }); } catch { return PALETTES[0]; }
  }, [photo]);

  const setPhoto = useCallback(async (blob: Blob, label: string, ai?: PhotoState['ai']) => {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      setPhotoState(prev => { if (prev) URL.revokeObjectURL(prev.url); return { blob, img, url, label, ...(ai ? { ai } : {}) }; });
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }, []);
  const photoRef = useRef<PhotoState | null>(null);
  photoRef.current = photo;
  useEffect(() => () => { if (photoRef.current) URL.revokeObjectURL(photoRef.current.url); }, []);
  /** A further photograph under this id (the AI-extended one the resize sheet kept). */
  const addPhoto = useCallback(async (id: string, blob: Blob, label = 'Extended photo') => {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      setExtra(prev => ({ ...prev, [id]: { blob, img, url, label } }));
    } catch (e) { URL.revokeObjectURL(url); throw e; }
  }, []);
  const clearExtra = useCallback(() => setExtra(prev => { for (const v of Object.values(prev)) URL.revokeObjectURL(v.url); return {}; }), []);
  const extraRef = useRef(extra);
  extraRef.current = extra;

  // ── Laying out ──
  /** A document laid out by a template on a page's frame; anything added by hand stays. */
  const layOut = useCallback((doc: StoryDoc, t: AdTemplateId, f: Fields, isMarked = marked): StoryDoc => {
    const d = applyAdTemplate(doc, t, f, assetsRef.current, { photoMarked: isMarked });
    return { ...d, meta: { ...d.meta, template: t } };
  }, [marked]);

  /** A fresh page's first document: the caller's own (a rebuilt flat ad), else the template. */
  const makePage = (p: WorkPage, w: DesignWork): StoryDoc => composeRef.current?.(p)
    // The website's own page is the catalogue's photograph: the piece, the weight stamped, the mark.
    ?? (isCataloguePage(p) ? applySquarePreset(blankAd(p.format, p.frame), 'catalogue', w.fields, assetsRef.current) : layOut({ ...blankAd(p.format, p.frame) }, w.template, w.fields));

  // A fresh design is laid out once its photo and the house's marks are in.
  useEffect(() => {
    if (!work?.fresh || !marksReady || starting) return;
    if (!photo) return;
    setWork(w => (w?.fresh ? layOutAll(w, p => makePage(p, w)) : w));
  }, [work?.fresh, marksReady, photo, starting, layOut]);

  // ── Starting, opening, closing ──
  const begin = useCallback((w: DesignWork, id: string | null) => {
    draftId.current = id ?? newDraftId();
    createdAt.current = new Date().toISOString();
    storedPhotos.current = new Set();
    writeCurrent(draftId.current);
    setTrail([]); setAiBusy(null); setAiDialog(null); setCandidate(null);
    setWork(w);
  }, [setCandidate]);

  const start = useCallback(async (req: StartRequest) => {
    setStarting(true);
    try {
      composeRef.current = req.compose ?? null;
      clearExtra();
      let blob: Blob | null = null;
      if (req.photo) blob = await req.photo.load();
      if (blob) await setPhoto(blob, req.photo!.label); else setPhotoState(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
      setMarked(!!req.photo?.marked);
      const w = newWork({
        ...req, fields: { ...req.photo?.fields, ...req.fields }, ...(req.photo?.source ? { source: req.photo.source } : {}),
        name: req.name ?? '',
      });
      begin(w, null);
      return true;
    } catch (e) {
      toast({ title: 'Couldn’t start', description: fail(e), variant: 'destructive' });
      return false;
    } finally { setStarting(false); }
  }, [begin, setPhoto, clearExtra, toast]);

  // A design with no photograph is laid out too.
  useEffect(() => {
    if (!work?.fresh || photo || !marksReady || starting) return;
    const t = setTimeout(() => setWork(w => (w?.fresh ? layOutAll(w, p => makePage(p, w)) : w)), 0);
    return () => clearTimeout(t);
  }, [work?.fresh, photo, marksReady, starting, layOut]);

  const close = useCallback(() => {
    setWork(null); writeCurrent(null); draftId.current = null; composeRef.current = null; clearExtra();
    setTrail([]); setAiBusy(null); setAiDialog(null); setCandidate(null);
  }, [clearExtra, setCandidate]);

  /** A saved design (or a legacy saved ad), with each page's document and its photograph. */
  const openRecord = useCallback(async (rec: DesignRecord) => {
    setStarting(true);
    try {
      const base = `/api/design/designs/${encodeURIComponent(rec.id)}`;
      const headers = await authHeaders();
      const get = async (key: string) => fetch(`${base}?key=${encodeURIComponent(key)}`, { headers, cache: 'no-store' });
      const docs: Record<string, StoryDoc> = {};
      await Promise.all(rec.pages.map(async p => {
        const res = await get(fileKey('doc', p.id));
        if (!res.ok) throw new Error('This design has no layout saved to open again.');
        docs[p.id] = (await res.json()) as StoryDoc;
      }));
      // The photograph it is drawn on: ours is 'photo:photo'; a legacy saved ad's is 'photo:main'.
      let res = await get(fileKey('photo', PHOTO));
      if (!res.ok) res = await get(fileKey('photo', 'main'));
      if (res.ok) await setPhoto(await res.blob(), rec.name); else setPhotoState(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
      setMarked(false);
      composeRef.current = null;
      clearExtra();
      for (const id of otherPhotoIds(Object.values(docs))) {
        const r = await get(fileKey('photo', id));
        if (r.ok) await addPhoto(id, await r.blob()).catch(() => undefined);
      }
      const w = fromRecord(rec, docs);
      if (!w) throw new Error('This design can’t be opened.');
      begin(w, null);
    } catch (e) {
      toast({ title: 'Couldn’t open it', description: fail(e), variant: 'destructive' });
    } finally { setStarting(false); }
  }, [begin, setPhoto, addPhoto, clearExtra, toast]);

  /** A device draft of this page's own (a Post a piece draft is not opened here). */
  const openDraft = useCallback(async (id: string) => {
    setStarting(true);
    try {
      const got = await readPostDraft<unknown>(id);
      if (!got || !isDesignDraft(got.draft.state)) throw new Error('That draft isn’t here any more.');
      const w = deserializeWork(got.draft.state);
      if (!w) throw new Error('That draft can’t be opened.');
      const blob = got.blobs.get(PHOTO);
      if (blob) await setPhoto(blob, got.draft.title); else setPhotoState(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
      composeRef.current = null;
      clearExtra();
      const others = got.draft.photos.map(p => p.id).filter(k => k !== PHOTO && got.blobs.has(k));
      for (const k of others) await addPhoto(k, got.blobs.get(k)!).catch(() => undefined);
      draftId.current = id;
      createdAt.current = got.draft.createdAt;
      storedPhotos.current = new Set([...(blob ? [PHOTO] : []), ...others]);
      writeCurrent(id);
      setTrail([]); setAiBusy(null); setAiDialog(null); setCandidate(null);
      setWork(w);
    } catch (e) {
      toast({ title: 'Couldn’t open it', description: fail(e), variant: 'destructive' });
    } finally { setStarting(false); }
  }, [setPhoto, addPhoto, clearExtra, setCandidate, toast]);

  /**
   * A draft of the old Post a piece screen, opened as a design (old-draft.ts). False when it cannot be (the caller
   * offers the read-only view). The old draft is removed once the design has been kept on this device in its place.
   */
  const openOldDraft = useCallback(async (id: string): Promise<{ ok: boolean; partlySent?: boolean }> => {
    setStarting(true);
    try {
      const got = await readPostDraft<OldDraftState>(id);
      if (!got || !isOldPostDraft(got.draft.state)) return { ok: false };
      const opened: OpenedOldDraft | null = convertOldDraft(got.draft, got.blobs);
      if (!opened) return { ok: false };
      if (opened.main) await setPhoto(opened.main.blob, opened.main.label); else setPhotoState(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
      setMarked(opened.marked);
      composeRef.current = null;
      clearExtra();
      for (const [k, b] of opened.more) await addPhoto(k, b, k.startsWith('ai-') ? 'AI picture' : 'Photo').catch(() => undefined);
      if (opened.folder) { try { localStorage.setItem('taheri_post_folder', opened.folder); } catch { /* fine */ } }
      begin(opened.work, null);
      pendingOld.current = id;
      return { ok: true, partlySent: opened.partlySent };
    } catch (e) {
      toast({ title: 'Couldn’t open it', description: fail(e), variant: 'destructive' });
      return { ok: false };
    } finally { setStarting(false); }
  }, [begin, setPhoto, addPhoto, clearExtra, toast]);

  // The design left open on this device comes back (never over one already open).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    // An address that asks for something (?draft=, ?site=, ?new=1) is answered by the page, not by what was left open.
    if (typeof window !== 'undefined' && /[?&](draft|site|new)(=|&|$)/.test(window.location.search)) return;
    const id = readCurrent();
    if (id) void listPostDrafts().then(l => { if (l.some(d => d.id === id && isDesignDraft(d.state))) void openDraft(id); }).catch(() => undefined);
  }, [openDraft]);

  // ── The device draft: written 1.5 s after the last change ──
  useEffect(() => {
    if (!work || work.fresh || !draftId.current) return;
    const id = draftId.current;
    const t = setTimeout(async () => {
      const w = workRef.current;
      if (!w || w.fresh || draftId.current !== id) return;
      const blobs = new Map<string, Blob>();
      if (photo) blobs.set(PHOTO, photo.blob);
      const more = Object.entries(extraRef.current);
      for (const [k, v] of more) blobs.set(k, v.blob);
      const draft: PostDraft = {
        id, createdAt: createdAt.current, updatedAt: new Date().toISOString(), title: displayName(w),
        photos: [...(photo ? [PHOTO] : []), ...more.map(([k]) => k)].map(k => ({ id: k, name: `${k}.jpg`, toSite: false, toWhatsApp: false })),
        thumb: photo ? await thumbOf(photo.img) : null, state: serializeWork(w) as unknown as Record<string, unknown>,
      };
      try {
        await savePostDraft(draft, blobs, storedPhotos.current); setDraftSaved(new Date());
        // A draft of the old screen that was opened as this design goes once this one is kept in its place.
        if (pendingOld.current) { const old = pendingOld.current; pendingOld.current = null; void deletePostDraft(old).catch(() => undefined); }
      } catch { /* storage full or private mode: the design is still on screen */ }
    }, 1500);
    return () => clearTimeout(t);
  }, [work, photo, extra]);

  /** The draft goes once the design is sent on (as Post a piece's does). */
  const finish = useCallback(() => {
    const id = draftId.current;
    if (id) void deletePostDraft(id).catch(() => undefined);
    writeCurrent(null);
  }, []);

  // ── Changes ──
  const change = useCallback((fn: (w: DesignWork) => DesignWork) => setWork(w => (w ? fn(w) : w)), []);
  const onDoc = useCallback((pageId: string, doc: StoryDoc) => change(w => editDoc(w, pageId, doc)), [change]);
  const patchFields = useCallback((f: Partial<Fields>) => change(w => setFields(w, f)), [change]);

  /** A new photograph in place of the picture (an AI result, one from the Photos section, one from this device). */
  const replacePhoto = useCallback(async (blob: Blob, label: string, clean = false, ai?: { check: CheckResult | null }) => {
    // An AI version keeps the photograph before it (to go back to, and as the real one for the same-piece check);
    // a photograph the person chose starts over.
    const before = photoRef.current;
    setTrail(t => (ai ? (before ? [...t, { blob: before.blob, label: before.label }].slice(-6) : t) : []));
    await setPhoto(blob, label, ai);
    if (clean) {
      setMarked(false);
      change(w => layOutAll(w, p => layOut(p.doc, (p.doc.meta?.template as AdTemplateId | undefined) ?? w.template, w.fields, false)));
    }
  }, [change, layOut, setPhoto]);

  /** Back to the photograph before the last AI version. */
  const undoPhoto = useCallback(async () => {
    const back = trail[trail.length - 1];
    if (!back) return;
    setTrail(t => t.slice(0, -1));
    await setPhoto(back.blob, back.label);
  }, [trail, setPhoto]);

  /** More photographs of the piece (other angles): extras named `more-…`, which Publish sends as squares of their own. */
  const addMore = useCallback(async (files: File[]) => {
    for (const f of files) {
      const r = await readImageFile(f);
      await addPhoto(`more-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, r.blob, r.name);
    }
  }, [addPhoto]);
  const removeMore = useCallback((id: string) => setExtra(prev => { const { [id]: gone, ...rest } = prev; if (gone) URL.revokeObjectURL(gone.url); return rest; }), []);
  const moreIds = useMemo(() => Object.keys(extra).filter(k => k.startsWith('more-')), [extra]);

  /** A page drawn over another of the design's photographs (a further angle), at this width. */
  const renderWith = useCallback(async (pageId: string, photoId: string, px: number, quality = 0.92): Promise<Blob> => {
    const w = workRef.current;
    const p = w && pageOf(w, pageId);
    if (!w || !p) throw new Error('That page is gone.');
    const a = assetsRef.current;
    const doc = withPlacement({ ...p.doc, bg: { ...p.doc.bg, photoId } }, { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 });
    return canvasToJpeg(renderDocTo(reflow(doc, w.fields, a), w.fields, a, px), quality);
  }, []);

  /** Draw a page at this width. */
  const render = useCallback(async (pageId: string, px: number, quality = 0.92): Promise<Blob> => {
    const w = workRef.current;
    const p = w && pageOf(w, pageId);
    if (!w || !p) throw new Error('That page is gone.');
    const a = assetsRef.current;
    return canvasToJpeg(renderDocTo(reflow(p.doc, w.fields, a), w.fields, a, px), quality);
  }, []);

  // ── Save to the shop ──
  const saveToShop = useCallback(async (folder?: string | null): Promise<DesignRecord | null> => {
    const w0 = workRef.current;
    if (!w0 || w0.fresh) return null;
    setSaving(true);
    try {
      const w = folder === undefined ? w0 : refile(w0, folder);
      const small = await render(w.master, 200, 0.7);
      const thumb = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(small); });
      const input = toInput(w, thumb);
      if (!input) throw new Error('This isn’t ready to save.');
      const form = new FormData();
      form.append('meta', JSON.stringify(input));
      if (w.id) form.append('id', w.id);
      for (const p of w.pages) {
        form.append(fileKey('doc', p.id), new Blob([JSON.stringify(p.doc)], { type: 'application/json' }), 'doc.json');
        form.append(fileKey('image', p.id), await render(p.id, Math.min(2160, Math.max(p.frame.w, 1080))), 'page.jpg');
      }
      const a = photo?.img;
      if (a) {
        const k = Math.min(1, 2048 / Math.max(a.naturalWidth, a.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(a.naturalWidth * k); c.height = Math.round(a.naturalHeight * k);
        c.getContext('2d')!.drawImage(a, 0, 0, c.width, c.height);
        form.append(fileKey('photo', PHOTO), await canvasToJpeg(c, 0.9), 'photo.jpg');
      }
      for (const [k, v] of Object.entries(extraRef.current)) {
        if (!w.pages.some(p => docUses(p.doc, k))) continue;
        const c = document.createElement('canvas');
        const m = Math.min(1, 2048 / Math.max(v.img.naturalWidth, v.img.naturalHeight));
        c.width = Math.round(v.img.naturalWidth * m); c.height = Math.round(v.img.naturalHeight * m);
        c.getContext('2d')!.drawImage(v.img, 0, 0, c.width, c.height);
        form.append(fileKey('photo', k), await canvasToJpeg(c, 0.9), 'photo.jpg');
      }
      const res = await fetch('/api/design/designs', { method: 'POST', headers: await authHeaders(), body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `The server answered ${res.status}.`);
      const item = d.item as DesignRecord;
      setWork(cur => (cur ? markSaved(cur, item.id, item.folder) : cur));
      toast({ title: 'Saved', description: 'On the Saved shelf.' });
      return item;
    } catch (e) {
      toast({ title: 'Couldn’t save it', description: fail(e), variant: 'destructive' });
      return null;
    } finally { setSaving(false); }
  }, [photo, render, toast]);

  return {
    adoptSaved: (id: string, folder: string | null = null) => setWork(cur => (cur ? markSaved(cur, id, cur.folder ?? folder) : cur)),
    addPhoto,
    work, photo, assets, marks, marksReady, marked, setMarked, starting, saving, draftSaved, email, palette,
    moreIds, addMore, removeMore, renderWith, extra,
    aiBusy, setAiBusy, aiDialog, setAiDialog, tidy, setTidy, candidate, setCandidate, checkTick, requestCheck: () => setCheckTick(n => n + 1),
    /** The photograph the AI started from: the first one before the AI versions, else the current. */
    original: trail[0]?.blob ?? photo?.blob ?? null, canUndoPhoto: trail.length > 0, undoPhoto,
    start, openRecord, openDraft, openOldDraft, close, finish, change, onDoc, patchFields, layOut, replacePhoto, render, saveToShop,
    // The pure steps, bound to the work.
    actions: {
      setActive: (id: string) => change(w => setActive(w, id)),
      addPages: (pages: NewPage[]) => change(w => addPages(w, pages)),
      removePage: (id: string) => change(w => removePage(w, id)),
      setMaster: (id: string) => change(w => setMaster(w, id)),
      rename: (name: string) => change(w => rename(w, name)),
      setCopy: (c: Parameters<typeof setCopy>[1]) => change(w => setCopy(w, c)),
      setDoc: (id: string, doc: StoryDoc) => change(w => setDoc(w, id, doc)),
      redoFromMaster: (id: string, doc: StoryDoc) => change(w => redoFromMaster(w, id, doc)),
    },
    activePage: work ? activePage(work) : null,
  };
}

export type DesignApi = ReturnType<typeof useDesign>;
