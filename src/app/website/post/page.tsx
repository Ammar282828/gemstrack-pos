'use client';

/**
 * Post a Piece — one piece, everywhere it goes, from one screen.
 *
 * The counter has photographed something new. Here they add the photos, type
 * the weight and a headline once, and the page makes everything else from
 * that: the Instagram story in the shop's own style, the WhatsApp caption, and
 * the website photo with the weight stamped in the corner. One press then
 * sends it all — the website, the set of the day, the community's groups and
 * the WhatsApp channel (each a tick of its own; the channel only when the line is
 * on WAHA, otherwise it goes by hand), the Instagram story — and hands anything
 * else to the phone's share sheet.
 *
 * A piece usually goes out as both a story and a post, so the two are made
 * together — both in view side by side, one designer that flips between them,
 * one Publish for both — and either can be left out: "Story only" or "Post
 * only" (remembered on this device) hides the other one and everything that
 * only it needs. A story Instagram doesn't take by itself (not connected, or
 * switched off to add music) becomes the last step: share it from the phone.
 *
 * Or several pieces in one go: "Add to queue" keeps a finished piece (its
 * squares and story exactly as drawn here) on the server and clears the page
 * for the next; the queue then sends them all now, or spread over the day at
 * times the counter can change (src/lib/social/queue.ts, sent by the tick).
 *
 * AI does as much or as little as asked (Gemini on Vertex, /api/website/post/ai):
 * retouch a photo, extend it to the story's shape, put the piece in one of the
 * shop's story settings, make the whole story from a single photo, letter it,
 * and write the captions. Every AI image is checked against the photo it came
 * from and says so on its tile; which photos go to the website and WhatsApp is
 * the counter's choice per photo, AI or not.
 *
 * Nothing leaves until Publish, and the community (a thousand-odd customers)
 * asks once more before it is written to. Every step reports on its own and can
 * be retried on its own: a slow website must not stop the WhatsApp post, and a
 * failed post must not be sent twice.
 *
 * No sign-in of its own, like Add Photos: the page runs on whatever the POS
 * runs on.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import {
  Send, ImagePlus, Camera, X, Star, Loader2, Check, RotateCw, Share2, Download, Copy, ExternalLink, Instagram,
  MessageCircle, Globe, Sparkles, Wand2, Expand, Palette as PaletteIcon, Type, ShieldCheck, ShieldAlert, Link2, MessageSquareText,
  Radio, ListPlus, ChevronDown, MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_LINKS, STORE_WEBSITE_FEATURED, STORE_WHATSAPP_NUMBERS, STORE_POST_METAL, STORE_MARK_SVG, STORE_MONOGRAM_SVG, STORE_POST_PIECE, STORE_POST_TAGLINE, STORE_POST_FOOTER } from '@/lib/store-config';
import { detailsLine, waNumberFromUrl, weightLabel, websiteFileName, whatsappCaption } from '@/lib/social/caption';
import { PALETTES, STORY_H, STORY_W, canvasToJpeg, loadImage, loadStampFont, stampPhoto, suggestPalette } from '@/lib/social/story';
import { SCENES, customPrompt, restagePrompt, type Aspect, type CaptionResult, type CheckResult } from '@/lib/social/prompts';
import { PRESETS, SQUARE_PRESETS, applyPreset, applySquarePreset, emptyDoc, emptySquare, reflow, renderDoc, renderDocTo, type Assets, type Bind, type Fields, type PresetId, type SquarePresetId, type StoryDoc, type TextLayer } from '@/lib/social/editor';
import type { Palette } from '@/lib/social/palettes';
import { PairEditor, useStoryDoc, type PairKey } from './story-editor';
import { FONTS, headlineFace, bodyFace } from './fonts';
import { diagnose, type Where } from '@/lib/social/diagnose';
import { HealthPanel, useHealth, reportError, ActionButton, type Check as HealthCheck } from './health-panel';
import { QueuePanel, useQueue, listOf } from './queue-panel';

const FILL = { mode: 'fill' as const, zoom: 1, focusX: 0.5, focusY: 0.5 };

const SITE = (STORE_LINKS.website || '').replace(/\/+$/, '');
const SITE_NAME = SITE.replace(/^https?:\/\//, '');
const NUMBERS = STORE_WHATSAPP_NUMBERS.length ? STORE_WHATSAPP_NUMBERS : [waNumberFromUrl(STORE_LINKS.whatsapp)].filter(Boolean);

interface Collection { collection: string; category: string; count: number; folder: string; path?: string }
/**
 * A photo on the page — one the counter added, or one AI made from another.
 * `url` is an object URL the tile and the canvas both draw from; revoked when
 * the photo is removed.
 */
interface Photo {
  id: string;
  name: string;
  img: HTMLImageElement;
  url: string;
  ai?: { label: string; parentId: string; check: CheckResult | null };
  toSite: boolean;
  toWhatsApp: boolean;
}
type StepStatus = 'waiting' | 'running' | 'done' | 'failed';
/** `manual`: a step the counter does from the phone (sharing the story); Publish lists it but doesn't run it. */
interface Step { id: string; label: string; status: StepStatus; error?: string; errStatus?: number; note?: string; manual?: boolean }
/** What this piece is made into: a story and a post (the usual), or just one of them. */
type Formats = 'both' | 'story' | 'square';
const FORMATS_KEY = 'taheri_post_formats';
const STEP_WHERE: Record<string, Where> = { website: 'website', featured: 'featured', whatsapp: 'whatsapp', instagram: 'instagram' };
/** A step's place for diagnose(): each WhatsApp destination is a step of its own ("wa:announcements"). */
const whereOfStep = (id: string): Where => STEP_WHERE[id] ?? (id.startsWith('wa:') ? 'whatsapp' : 'page');
/** One of the community's groups a post can go to (destinations.ts), as GET /api/website/post names it. */
interface WaGroup { key: string; label: string; name: string; size: number | null; reachable: boolean }
/** An Error that remembers the HTTP status it came with, for diagnose(). */
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const errStatus = (e: unknown) => (typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : undefined);
interface Lettered { url: string; img: HTMLImageElement; verified: boolean; missing: string[]; forId: string }

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

const newId = (s: string) => `${s}-${Math.random().toString(36).slice(2, 9)}`;

/** A photo the canvas can draw. HEIC that this browser cannot read goes to the server and comes back a JPEG. */
async function readPhoto(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  const base = { id: newId(file.name), toSite: true, toWhatsApp: true };
  try {
    return { ...base, name: file.name, img: await loadImage(url), url };
  } catch {
    URL.revokeObjectURL(url);
    const form = new FormData();
    form.set('file', file, file.name);
    const res = await fetch('/api/website/post/convert', { method: 'POST', headers: await authHeaders(), body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not read ${file.name}`);
    const jpegUrl = URL.createObjectURL(await res.blob());
    return { ...base, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', img: await loadImage(jpegUrl), url: jpegUrl };
  }
}

/** An image the AI returned, ready for the page. */
async function fromBase64(data: string, mime: string): Promise<{ url: string; img: HTMLImageElement }> {
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  return { url, img: await loadImage(url) };
}

/** What the AI is sent: the photo at most 2048 on its long side, as a JPEG. */
const forAi = (img: HTMLImageElement) => stampPhoto(img, { text: '', colour: 'auto', maxEdge: 2048 });

async function callAi<T>(op: string, images: Blob[], params: Record<string, unknown> = {}): Promise<T> {
  const form = new FormData();
  form.set('op', op);
  form.set('params', JSON.stringify(params));
  images.forEach((b, i) => form.append('image', b, `image-${i}.jpg`));
  const res = await fetch('/api/website/post/ai', { method: 'POST', headers: await authHeaders(), body: form });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(d.error || `AI request failed (${res.status})`, res.status);
  return d as T;
}

interface AiImageResponse { image: { mimeType: string; data: string }; check?: CheckResult | null }

const collectionUrl = (c: Collection | undefined) =>
  c && SITE ? `${SITE}${c.path ?? `/${c.collection.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}` : SITE;

const checkOk = (c: CheckResult | null | undefined) => !!c && c.samePiece && c.confidence >= 0.8;

export default function PostAPieceRoute() {
  // A wrapper, so the page's own hooks never sit behind an early return.
  if (!STORE_POST_PIECE) {
    return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn't post from the POS.</p>;
  }
  return <PostAPiecePage />;
}

function PostAPiecePage() {
  const { toast } = useToast();
  const health = useHealth();
  const queue = useQueue();
  const dctx = health.report?.context ?? {};
  /** A toast that says what went wrong and what to do, never the raw error. */
  const explain = (where: Where, e: unknown) => {
    const d = diagnose(where, { status: errStatus(e), message: e instanceof Error ? e.message : String(e) }, dctx);
    toast({ title: d.title, description: d.fix, variant: 'destructive' });
  };

  // ── What the counter enters ──
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [reading, setReading] = useState(0);
  const [kicker, setKicker] = useState('');
  const [headline, setHeadline] = useState('');
  const [weight, setWeight] = useState('');
  const [weightEach, setWeightEach] = useState(false);
  const [metal, setMetal] = useState(STORE_POST_METAL);
  const [stones, setStones] = useState('');
  const [hook, setHook] = useState('');
  // Folded until asked for: the piece's other details, the website name, the caption's extra line.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [hookOpen, setHookOpen] = useState(false);

  // ── The story: a document of layers (see story-editor.tsx); its background photo is the story photo ──
  const story = useStoryDoc(emptyDoc(null));
  const [palette, setPalette] = useState<Palette>(PALETTES[0]);
  const [weightOwnLine, setWeightOwnLine] = useState(true);
  const [lettering, setLettering] = useState<'ours' | 'ai'>('ours');
  const [lettered, setLettered] = useState<Lettered | null>(null);
  const [letterStyle, setLetterStyle] = useState('');

  // ── AI ──
  const [aiBusy, setAiBusy] = useState<Record<string, string>>({}); // key → what it is doing
  const [aiCaption, setAiCaption] = useState<CaptionResult | null>(null);
  const [restageFor, setRestageFor] = useState<{ photoId: string; aspect: Aspect } | null>(null);
  const [sceneId, setSceneId] = useState(SCENES[0].id);
  const [customScene, setCustomScene] = useState('');
  const [restagePromptText, setRestagePromptText] = useState<string | null>(null); // edited by hand, else null
  const [tidy, setTidy] = useState(true);
  const [askFor, setAskFor] = useState<{ photoId: string; aspect: Aspect | null } | null>(null);
  const [askText, setAskText] = useState('');
  const [askPromptText, setAskPromptText] = useState<string | null>(null);
  const [wholeOpen, setWholeOpen] = useState(false);
  const [wholeBrief, setWholeBrief] = useState('');

  // ── Where it goes ──
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [uploadsOn, setUploadsOn] = useState(true);
  const [toWebsite, setToWebsite] = useState(!!SITE);
  const [folder, setFolder] = useState('');
  const [siteName, setSiteName] = useState('');
  const [siteNameEdited, setSiteNameEdited] = useState(false);
  // The square every WhatsApp and website photo is made from: shared words and marks, a crop per photo.
  const square = useStoryDoc(emptySquare());
  // The design open in the editor; the other stays in view beside it.
  const [view, setView] = useState<PairKey>('story');
  const [formats, setFormats] = useState<Formats>('both');
  const makeStory = formats !== 'square';
  const makeSquare = formats !== 'story';
  const editorRef = useRef<HTMLDivElement>(null);
  /** Open a design in the editor and bring it into view (on a phone it sits below the form). */
  const showDesign = (k: PairKey) => { setView(k); editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const [feature, setFeature] = useState(false);
  const [community, setCommunity] = useState<{ name: string; size: number | null; reachable: boolean } | null>(null);
  // Whether WhatsApp could be asked about at all: a POS without WhatsApp settings (a local copy) says so rather than hiding it.
  const [waState, setWaState] = useState<'loading' | 'ready' | 'off' | 'error'>('loading');
  // The WhatsApp channel the route can post to (WAHA only); null when it has to be shared by hand.
  const [waChannel, setWaChannel] = useState<{ name: string; followers: number | null; reachable: boolean } | null>(null);
  const [waGroups, setWaGroups] = useState<WaGroup[]>([]);
  // Where this post's squares go: group keys, and "channel". The first group and the channel to start with.
  const [waTargets, setWaTargets] = useState<string[]>([]);
  const [toWhatsApp, setToWhatsApp] = useState(false);
  const [caption, setCaption] = useState('');
  const [captionEdited, setCaptionEdited] = useState(false);
  const [ig, setIg] = useState<{ configured: boolean; connected: boolean; username: string | null } | null>(null);
  const [toInstagram, setToInstagram] = useState(false);

  // ── Publishing ──
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [publishing, setPublishing] = useState(false);
  // The story has been shared or saved from this page — the queue can't carry one Instagram won't take by itself.
  const [storyOut, setStoryOut] = useState(false);
  const uploadedRef = useRef<Record<string, string>>({});   // photo id → website rel, so a retry never uploads twice
  const sentRef = useRef<Record<string, boolean>>({});        // WhatsApp message key → sent

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [marks, setMarks] = useState<Assets['marks']>({});
  const [fontsReady, setFontsReady] = useState(false);

  const hero = photos.find(p => p.id === story.doc.bg.photoId) ?? photos[0] ?? null;
  /** Make a photo the story's background (and so the lead photo everywhere). */
  const setHeroId = (id: string | null) => story.change(d => ({ ...d, bg: { ...d.bg, photoId: id, placement: FILL } }), { key: 'hero' });
  const chosen = collections?.find(c => c.folder === folder);
  const link = collectionUrl(toWebsite ? chosen : undefined);
  const piece = useMemo(() => ({ headline, kicker, weight, weightEach, metal, stones, hook }), [headline, kicker, weight, weightEach, metal, stones, hook]);
  const wLabel = weightLabel(piece);
  // The details line carries the weight only when the story has no weight line of its own.
  const weightShown = story.doc.layers.some(l => l.kind === 'text' && l.bind === 'weight' && !l.hidden);
  const fields: Fields = useMemo(() => ({ kicker, headline, weight: wLabel, details: detailsLine(piece, !weightShown) }), [kicker, headline, wLabel, piece, weightShown]);
  const assets: Assets = useMemo(() => ({ photos: Object.fromEntries(photos.map(p => [p.id, p.img])), marks, fonts: FONTS }), [photos, marks]);
  // Photos that go out as squares: everything ticked for the website or WhatsApp.
  const squarePhotos = photos.filter(p => p.toSite || p.toWhatsApp);
  const weightStamped = square.doc.layers.some(l => l.kind === 'text' && l.bind === 'weight' && !l.hidden);
  /** A photo's square, as a JPEG `px` wide: the square's layers over that photo's own crop. */
  const squareJpeg = async (p: Photo, px: number) => {
    const doc: StoryDoc = { ...square.doc, bg: { ...square.doc.bg, photoId: p.id } };
    return canvasToJpeg(renderDocTo(reflow(doc, fields, assets), fields, assets, px), 0.92);
  };
  /** Website squares at the catalogue's 3000 px when the photo has that much detail; never below 1080. */
  const siteSize = (p: Photo) => Math.max(1080, Math.min(3000, Math.min(p.img.naturalWidth, p.img.naturalHeight)));
  const busyAny = Object.keys(aiBusy).length > 0;
  const setBusy = (key: string, what: string | null) => setAiBusy(prev => { const n = { ...prev }; if (what) n[key] = what; else delete n[key]; return n; });

  // ── Loading what the page needs ──
  useEffect(() => {
    Promise.all([
      document.fonts.load(`800 100px ${FONTS.headline}`), document.fonts.load(`300 40px ${FONTS.body}`),
      document.fonts.load(`400 40px ${FONTS.body}`), document.fonts.load(`700 40px ${FONTS.body}`),
      document.fonts.load(`500 40px ${FONTS.serif}`), document.fonts.load(`italic 400 40px ${FONTS.serif}`),
      loadStampFont(),
      // The marks too: layouts measure them when they place them.
      Promise.all([
        loadImage(STORE_MARK_SVG).then(img => ({ wordmark: img })).catch(() => ({})),
        STORE_MONOGRAM_SVG ? loadImage(STORE_MONOGRAM_SVG).then(img => ({ t: img })).catch(() => ({})) : Promise.resolve({}),
      ]).then(([w, t]) => setMarks({ ...w, ...t })),
    ]).catch(() => undefined).then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/instagram/status', { headers: await authHeaders(), cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      setIg(d);
      if (d.connected) setToInstagram(true);
    })();
    // Back from Instagram's approval page.
    const q = new URLSearchParams(window.location.search);
    if (q.get('instagram') === 'connected') toast({ title: `Instagram connected as @${q.get('username')}`, description: 'Stories now post straight from here.' });
    if (q.get('instagram') === 'error') {
      const d = diagnose('instagram-connect', q.get('reason') || '');
      toast({ title: `Instagram was not connected — ${d.title.toLowerCase()}`, description: d.fix, variant: 'destructive' });
    }
    if (q.get('instagram')) window.history.replaceState(null, '', window.location.pathname);
    if (!SITE) return;
    (async () => {
      const res = await fetch('/api/website/photos', { headers: await authHeaders(), cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      setCollections(d.collections);
      setUploadsOn(d.configured !== false);
      try { const last = localStorage.getItem('taheri_post_folder'); if (last && d.collections.some((c: Collection) => c.folder === last)) setFolder(last); } catch { /* fine */ }
    })();
    (async () => {
      const res = await fetch('/api/website/post', { headers: await authHeaders(), cache: 'no-store' }).catch(() => null);
      if (!res?.ok) { setWaState('error'); return; }
      const d = await res.json();
      setWaState(d.community ? 'ready' : 'off');
      if (d.community) { setCommunity(d.community); setToWhatsApp(true); }
      if (d.channel) setWaChannel(d.channel);
      const groups: WaGroup[] = d.groups ?? [];
      setWaGroups(groups);
      setWaTargets([...groups.slice(0, 1).map(g => g.key), ...(d.channel ? ['channel'] : [])]);
    })();
  }, [toast]);
  useEffect(() => { if (folder) try { localStorage.setItem('taheri_post_folder', folder); } catch { /* fine */ } }, [folder]);
  useEffect(() => {
    try { const f = localStorage.getItem(FORMATS_KEY); if (f === 'story' || f === 'square' || f === 'both') { setFormats(f); if (f === 'square') setView('square'); } } catch { /* fine */ }
  }, []);
  const chooseFormats = (f: Formats) => {
    setFormats(f);
    setView(v => f === 'story' ? 'story' : f === 'square' ? 'square' : v);
    try { localStorage.setItem(FORMATS_KEY, f); } catch { /* fine */ }
  };

  // The website name follows the headline until someone types their own.
  useEffect(() => {
    if (siteNameEdited) return;
    const generic = !headline.trim() || /^set of the day$/i.test(headline.trim());
    setSiteName(generic ? (chosen?.collection ?? '') : headline.trim());
  }, [headline, chosen, siteNameEdited]);

  // The caption follows the fields until someone (or the AI) writes it.
  useEffect(() => {
    if (captionEdited) return;
    setCaption(headline.trim() ? whatsappCaption(piece, { whatsappNumbers: NUMBERS, link, tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER }) : '');
  }, [piece, link, captionEdited, headline]);

  // The first photo starts the story in the shop's usual layout, coloured for that photo.
  useEffect(() => {
    if (!fontsReady || !photos.length || story.doc.layers.length || story.doc.bg.photoId) return;
    const first = photos[0];
    const p = suggestPalette(first.img, FILL);
    setPalette(p);
    story.reset(applyPreset(emptyDoc(first.id), 'stack-left', p, fields, assets, { weightOwnLine: true, wordmark: true }));
  }, [fontsReady, photos, story, fields, assets]);
  // The square starts as the catalogue stamp, the way every catalogue photo already looks.
  useEffect(() => {
    if (!fontsReady || square.doc.layers.length) return;
    square.reset(applySquarePreset(emptySquare(), 'catalogue', fields, assets));
  }, [fontsReady, square, fields, assets]);
  // The square shows a photo that is actually going out as one.
  useEffect(() => {
    const id = square.doc.bg.photoId;
    if (squarePhotos.length && (!id || !squarePhotos.some(p => p.id === id))) {
      square.change(d => ({ ...d, bg: { ...d.bg, photoId: squarePhotos[0].id } }), { live: true });
    }
  }, [squarePhotos, square]);
  // The starred photo leads both: when it changes, the post shows it too (if it goes out as a square).
  const heroId = hero?.id;
  useEffect(() => {
    if (heroId && squarePhotos.some(p => p.id === heroId)) square.change(d => d.bg.photoId === heroId ? d : ({ ...d, bg: { ...d.bg, photoId: heroId } }), { live: true });
  }, [heroId]); // eslint-disable-line react-hooks/exhaustive-deps
  // A removed story photo hands over to the first one left.
  useEffect(() => {
    if (story.doc.bg.photoId && !photos.some(p => p.id === story.doc.bg.photoId)) setHeroId(photos[0]?.id ?? null);
  }, [photos, story.doc.bg.photoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // With AI lettering on and made for this photo, the story IS that image; our bound text stays off it.
  const aiLettered = lettering === 'ai' && lettered && hero && lettered.forId === hero.id ? lettered : null;

  // ── Photos ──
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => /^image\//i.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (!list.length) return;
    setReading(n => n + list.length);
    for (const f of list) {
      try {
        const p = await readPhoto(f);
        setPhotos(prev => [...prev, p]);
      } catch (e) {
        toast({ title: 'Could not read a photo', description: e instanceof Error ? e.message : f.name, variant: 'destructive' });
      } finally {
        setReading(n => n - 1);
      }
    }
  }, [toast]);

  const removePhoto = (id: string) => {
    setPhotos(prev => { prev.filter(p => p.id === id).forEach(p => URL.revokeObjectURL(p.url)); return prev.filter(p => p.id !== id); });
  };
  const patchPhoto = (id: string, patch: Partial<Photo>) => setPhotos(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  // Object URLs are a real allocation; let them go with the page.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => { photosRef.current.forEach(p => URL.revokeObjectURL(p.url)); }, []);

  // ── AI on a photo ──
  /**
   * Run an image op on a photo and add the result beside it. A story-shaped
   * result becomes the story photo and goes nowhere else by default; any other
   * takes over its parent's places (the counter asked for a better version of
   * that photo), and the parent steps back.
   */
  const aiImage = async (source: Photo, op: 'enhance' | 'reframe' | 'restage' | 'custom', params: Record<string, unknown>, label: string) => {
    const key = `${op}-${source.id}-${Date.now()}`;
    setBusy(key, label);
    try {
      const d = await callAi<AiImageResponse & { aspect?: Aspect }>(op, [await forAi(source.img)], params);
      const { url, img } = await fromBase64(d.image.data, d.image.mimeType);
      const storyShaped = d.aspect === '9:16';
      const made: Photo = {
        id: newId('ai'), name: `${label}.jpg`, img, url,
        ai: { label, parentId: source.id, check: d.check ?? null },
        toSite: !storyShaped && source.toSite, toWhatsApp: !storyShaped && source.toWhatsApp,
      };
      setPhotos(prev => {
        const i = prev.findIndex(p => p.id === source.id);
        const next = prev.map(p => (!storyShaped && p.id === source.id) ? { ...p, toSite: false, toWhatsApp: false } : p);
        next.splice(i + 1, 0, made);
        return next;
      });
      if (storyShaped || source.id === hero?.id) setHeroId(made.id);
      if (d.aspect === '1:1') square.change(doc => ({ ...doc, bg: { ...doc.bg, photoId: made.id } }), { live: true });
      if (!checkOk(d.check)) {
        toast({ title: d.check ? 'Check this one closely' : 'Could not check it', description: d.check?.differences[0] ?? 'Compare it with the original before posting.', variant: d.check ? 'destructive' : undefined });
      }
      return made;
    } catch (e) {
      explain('ai', e);
      return null;
    } finally {
      setBusy(key, null);
    }
  };

  const runRestage = async () => {
    if (!restageFor) return;
    const source = photos.find(p => p.id === restageFor.photoId);
    if (!source) return;
    const scene = SCENES.find(s => s.id === sceneId);
    const base = customScene.trim() ? { scene: customScene.trim(), aspect: restageFor.aspect } : { sceneId, aspect: restageFor.aspect };
    const params = restagePromptText?.trim() ? { ...base, rawPrompt: restagePromptText.trim() } : base;
    setRestageFor(null);
    setRestagePromptText(null);
    await aiImage(source, 'restage', params, customScene.trim() ? 'New setting' : scene?.label ?? 'New setting');
  };

  /** "Ask AI": the counter's own instruction, or their own whole prompt. */
  const runAsk = async () => {
    if (!askFor) return;
    const source = photos.find(p => p.id === askFor.photoId);
    if (!source || (!askText.trim() && !askPromptText?.trim())) return;
    const params = { instruction: askText.trim(), ...(askFor.aspect ? { aspect: askFor.aspect } : {}), ...(askPromptText?.trim() ? { rawPrompt: askPromptText.trim() } : {}) };
    setAskFor(null);
    setAskPromptText(null);
    await aiImage(source, 'custom', params, askText.trim().slice(0, 28) || 'Your edit');
  };

  // ── AI words ──
  const writeWithAi = async (opts: { quiet?: boolean; brief?: string } = {}): Promise<CaptionResult | null> => {
    if (!hero) return null;
    setBusy('caption', 'Writing the captions');
    try {
      const imgs = [hero, ...photos.filter(p => p.id !== hero.id && !p.ai)].slice(0, 2);
      const d = await callAi<{ caption: CaptionResult & { rebuilt?: boolean } }>('caption', await Promise.all(imgs.map(p => forAi(p.img))), {
        headline, weight: wLabel, metal, stones, collection: chosen?.collection ?? '', numbers: NUMBERS, link, brief: opts.brief ?? '',
      });
      const c = d.caption;
      setAiCaption(c);
      if (!headline.trim() && c.headlines[0]) setHeadline(c.headlines[0]);
      if (!hook.trim() && c.hook) setHook(c.hook);
      setCaption(c.whatsappCaption);
      setCaptionEdited(true);
      if (!opts.quiet) toast({ title: 'Captions written', description: c.stonesSeen && !stones ? `Stones look like: ${c.stonesSeen}. Add them if that is right.` : 'Read them over before sending.' });
      return c;
    } catch (e) {
      explain('caption', e);
      return null;
    } finally {
      setBusy('caption', null);
    }
  };

  /** One press: the words, the plan, and a story-shaped scene for the piece — steered by the counter's brief if they gave one. */
  const makeWholeStory = async (brief: string) => {
    if (!hero) return;
    const source = hero.ai ? photos.find(p => p.id === hero.ai!.parentId) ?? hero : hero;
    setBusy('whole', 'Making the story');
    try {
      const c = await writeWithAi({ quiet: true, brief });
      if (!c) return;
      if (!kicker && c.kicker) setKicker(c.kicker);
      const p = PALETTES.find(x => x.id === c.paletteId) ?? palette;
      setPalette(p);
      setWeightOwnLine(c.weightOwnLine);
      setLettering('ours');
      // Lay it out with the words it is about to have, not the ones the form held a second ago.
      const f2: Fields = { ...fields, headline: headline.trim() || c.headlines[0] || '', kicker: kicker || c.kicker };
      story.change(d => applyPreset(d, c.align === 'center' ? 'center' : 'stack-left', p, f2, assets, { weightOwnLine: c.weightOwnLine, wordmark: true }));
      const scene = SCENES.find(s => s.id === c.sceneId) ?? SCENES[0];
      const custom = brief.trim() && c.sceneBrief?.trim();
      const made = await aiImage(source, 'restage', custom ? { scene: c.sceneBrief, aspect: '9:16' } : { sceneId: scene.id, aspect: '9:16' }, custom ? 'Your story' : scene.label);
      if (made) toast({ title: 'Story made', description: `${custom ? c.sceneBrief : scene.label} — lettered in the shop’s fonts. Move or change anything.` });
    } finally {
      setBusy('whole', null);
    }
  };

  const letterWithAi = async () => {
    if (!hero || !headline.trim()) return;
    setBusy('letter', 'Lettering the story');
    try {
      const headLayer = story.doc.layers.find(l => l.kind === 'text' && l.bind === 'headline') as TextLayer | undefined;
      const d = await callAi<AiImageResponse & { lettering: { verified: boolean; missing: string[] } }>('letter', [await forAi(hero.img)], {
        kicker, headline, weight: weightShown ? wLabel : '', details: fields.details,
        headlineColour: headLayer?.color ?? palette.headline, bodyColour: palette.body, align: headLayer?.align === 'center' ? 'center' : 'left',
        style: letterStyle.trim(),
      });
      const { url, img } = await fromBase64(d.image.data, d.image.mimeType);
      if (lettered) URL.revokeObjectURL(lettered.url);
      setLettered({ url, img, verified: d.lettering.verified, missing: d.lettering.missing, forId: hero.id });
      setLettering('ai');
      if (!d.lettering.verified) toast({ title: 'The AI got some words wrong', description: `Could not find: ${d.lettering.missing.join(', ') || 'the text'}. Try again, or use our fonts.`, variant: 'destructive' });
    } catch (e) {
      explain('ai', e);
    } finally {
      setBusy('letter', null);
    }
  };

  // ── The story file: the same document the editor shows, rendered off-screen at full size ──
  const getStory = useCallback(async () => {
    if (!hero) throw new Error('Add a photo first');
    const c = document.createElement('canvas');
    c.width = STORY_W; c.height = STORY_H;
    renderDoc(c.getContext('2d')!, reflow(story.doc, fields, assets), fields, assets, aiLettered ? { background: aiLettered.img, hideBound: true } : {});
    return canvasToJpeg(c, 0.93);
  }, [hero, story.doc, fields, assets, aiLettered]);

  /** Typing into a bound layer on the story edits the piece's field. */
  const onField = (bind: Bind, value: string) => {
    if (bind === 'headline') setHeadline(value);
    else if (bind === 'kicker') setKicker(value);
    else if (bind === 'weight') { setWeight(value.replace(/[^\d.]/g, '')); setWeightEach(/each/i.test(value)); }
  };

  const fileNameBase = (headline.trim() || 'piece').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase();

  const shareFiles = async (files: File[], text?: string) => {
    const data: ShareData = { files, ...(text ? { text } : {}) };
    if (navigator.canShare?.(data)) {
      try { await navigator.share(data); return true; } catch (e) { if ((e as Error).name === 'AbortError') return true; }
    }
    return false;
  };
  const download = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const shareStory = async () => {
    const b = await getStory();
    const f = new File([b], `${fileNameBase}-story.jpg`, { type: 'image/jpeg' });
    if (!(await shareFiles([f]))) { download(b, f.name); toast({ title: 'Story saved', description: 'This browser cannot share files — post it from your phone’s photos.' }); }
    setStoryOut(true);
  };
  const saveStory = async () => { download(await getStory(), `${fileNameBase}-story.jpg`); setStoryOut(true); };
  /**
   * The story and the post squares in one go — on a phone the share sheet
   * offers "Save images" (all of them to Photos at once); elsewhere they download.
   */
  const saveBoth = async () => {
    const squares = hero && squarePhotos.some(p => p.id === hero.id) ? [hero, ...squarePhotos.filter(p => p.id !== hero.id)] : squarePhotos;
    const files = [
      new File([await getStory()], `${fileNameBase}-story.jpg`, { type: 'image/jpeg' }),
      ...await Promise.all(squares.map(async (p, i) => new File([await squareJpeg(p, 1600)], `${fileNameBase}-post${i ? `-${i + 1}` : ''}.jpg`, { type: 'image/jpeg' }))),
    ];
    setStoryOut(true);
    const data: ShareData = { files };
    if (!navigator.canShare?.(data)) { files.forEach((f, i) => setTimeout(() => download(f, f.name), i * 300)); return; }
    try { await navigator.share(data); }
    catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // Drawing them took longer than this browser allows after a tap: they're ready now, so one more tap opens the sheet.
      toast({
        title: `${files.length} images ready`, description: 'Tap Save to put them in your photos.',
        action: <ToastAction altText="Save the images" onClick={() => { navigator.share(data).catch(() => undefined); }}>Save</ToastAction>,
      });
    }
  };
  const copyText = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); }
    catch { toast({ title: 'Could not copy', description: 'Select it and copy it by hand.', variant: 'destructive' }); }
  };
  const waPhotos = () => { const sel = photos.filter(p => p.toWhatsApp); return hero && sel.some(p => p.id === hero.id) ? [hero, ...sel.filter(p => p.id !== hero.id)] : sel; };
  const shareToChannel = async () => {
    const first = waPhotos()[0];
    if (!first) { toast({ title: 'No photo is ticked for WhatsApp', description: 'Tick WA on a photo first — the channel gets the same post.' }); return; }
    const b = await squareJpeg(first, 1600);
    const f = new File([b], `${fileNameBase}.jpg`, { type: 'image/jpeg' });
    // WhatsApp often drops text shared alongside a file, so the caption goes on the clipboard too.
    try { await navigator.clipboard.writeText(caption); } catch { /* said below either way */ }
    if (!(await shareFiles([f], caption))) download(b, f.name);
    toast({ title: 'Caption is on the clipboard', description: waChannel ? `Paste it under the photo wherever you shared it.${waTargets.includes('channel') ? ' (The channel gets it automatically when you publish to WhatsApp.)' : ''}` : 'Paste it under the photo in the channel.' });
  };

  const connectInstagram = async () => {
    const res = await fetch('/api/instagram/connect', { method: 'POST', headers: await authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.url) { explain('instagram-connect', httpError(d.error || `${res.status}`, res.status)); return; }
    window.location.href = d.url;
  };

  // ── Publishing ──
  // The starred photo first on the website too: it is the one the set of the day shows.
  const sitePhotos = [...photos.filter(p => p.toSite && p.id === hero?.id), ...photos.filter(p => p.toSite && p.id !== hero?.id)];
  const siteOn = makeSquare && toWebsite && uploadsOn && !!folder && sitePhotos.length > 0;
  /** What a WhatsApp destination is called, and how many it reaches. */
  const waName = (k: string) => (k === 'channel' ? waChannel?.name ?? 'Channel' : waGroups.find(g => g.key === k)?.name ?? k);
  const waReach = (k: string) => (k === 'channel' ? (waChannel?.followers ? `${waChannel.followers.toLocaleString()} followers` : '') : (() => { const n = waGroups.find(g => g.key === k)?.size; return n ? `${n.toLocaleString()} members` : ''; })());
  // In the order they are offered: the groups, then the channel.
  const waChosen = [...waGroups.map(g => g.key), ...(waChannel ? ['channel'] : [])].filter(k => waTargets.includes(k));
  const waOn = makeSquare && toWhatsApp && !!community && waPhotos().length > 0 && waChosen.length > 0;
  const igOn = makeStory && toInstagram && !!ig?.connected;
  // A story Instagram won't take by itself (not connected here, or switched off to add music) goes from the phone.
  const storyByHand = makeStory && !igOn;
  const ready = !!hero && !!headline.trim();
  const targets = [siteOn && SITE_NAME, waOn && 'WhatsApp', igOn && 'Instagram'].filter(Boolean) as string[];
  // Checks that are failing for somewhere this post is about to go.
  const blockers: HealthCheck[] = (health.report?.checks ?? []).filter(c => c.status === 'fail' && (
    (siteOn && c.group === 'Website') || (waOn && c.group === 'WhatsApp') || (igOn && c.group === 'Instagram')));
  const problems: string[] = [];
  if (!photos.length) problems.push('Add a photo.');
  if (!headline.trim()) problems.push('Give it a headline.');
  if (makeSquare && SITE && toWebsite && !folder) problems.push(`Choose where it goes on ${SITE_NAME}, or switch the website off.`);
  if (makeSquare && toWhatsApp && community && !caption.trim()) problems.push('The WhatsApp caption is empty.');
  if (makeSquare && toWhatsApp && community && !waChosen.length) problems.push('Choose a WhatsApp group or the channel, or switch WhatsApp off.');
  if (makeStory && lettering === 'ai' && !aiLettered) problems.push('AI lettering is on but not made for this photo — letter it, or switch to our fonts.');

  const setStep = (id: string, patch: Partial<Step>) => setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  // Shared or saved from anywhere on the page, the by-hand story step is done.
  useEffect(() => { if (storyOut) setSteps(prev => prev.map(s => s.id === 'story-hand' ? { ...s, status: 'done' } : s)); }, [storyOut]);

  const uploadToWebsite = async (p: Photo, index: number, headers: Record<string, string>): Promise<string> => {
    if (uploadedRef.current[p.id]) return uploadedRef.current[p.id];
    const jpeg = await squareJpeg(p, siteSize(p));
    const name = websiteFileName(siteName || headline, index);
    const form = new FormData();
    form.set('folder', folder);
    form.set('name', name);
    form.set('file', jpeg, name);
    const res = await fetch('/api/website/photos', { method: 'POST', headers, body: form });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(d.error || `Upload failed (${res.status})`, res.status);
    uploadedRef.current[p.id] = d.rel;
    return d.rel;
  };

  /** One square to one WhatsApp destination (a group's key, or "channel"), once. */
  const sendWhatsApp = async (key: string, blob: Blob, name: string, text: string, target: string, headers: Record<string, string>) => {
    if (sentRef.current[key]) return;
    const form = new FormData();
    form.set('file', new File([blob], name, { type: 'image/jpeg' }));
    if (text) form.set('caption', text);
    form.set('targets', target);
    const res = await fetch('/api/website/post', { method: 'POST', headers, body: form });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(d.error || `WhatsApp send failed (${res.status})`, res.status);
    sentRef.current[key] = true;
  };

  const runPublish = async (only?: string) => {
    if (publishing || !hero) return;
    setPublishing(true);
    const headers = await authHeaders();
    const plan: Step[] = only ? steps : [
      ...(siteOn ? [{ id: 'website', label: `${SITE_NAME} · ${chosen?.collection ?? ''}`, status: 'waiting' as const }] : []),
      ...(siteOn && feature && STORE_WEBSITE_FEATURED ? [{ id: 'featured', label: 'Set of the day on the home page', status: 'waiting' as const }] : []),
      ...(igOn ? [{ id: 'instagram', label: `Instagram story · @${ig?.username}`, status: 'waiting' as const }] : []),
      // Each destination its own step, so one that fails is retried alone — never a group twice.
      ...(waOn ? waChosen.map(k => ({ id: `wa:${k}`, label: `WhatsApp · ${waName(k)}${k === 'channel' ? ' (channel)' : ''}`, status: 'waiting' as const })) : []),
      // Last, and by hand: the story, when Instagram isn't taking it by itself.
      ...(storyByHand ? [{ id: 'story-hand', label: 'Instagram story — share it from your phone', status: storyOut ? 'done' as const : 'waiting' as const, manual: true }] : []),
    ];
    if (!only) setSteps(plan);
    const todo = plan.filter(s => (only ? s.id === only : true) && s.status !== 'done' && !s.manual);
    let failedAny = false;

    for (const s of todo) {
      setStep(s.id, { status: 'running', error: undefined });
      try {
        if (s.id === 'website') {
          for (let i = 0; i < sitePhotos.length; i++) {
            setStep(s.id, { note: `${i + 1} of ${sitePhotos.length}` });
            await uploadToWebsite(sitePhotos[i], i, headers);
          }
          setStep(s.id, { note: `${sitePhotos.length} photo${sitePhotos.length === 1 ? '' : 's'}` });
        } else if (s.id === 'featured') {
          const lead = sitePhotos.find(p => p.id === hero.id) ?? sitePhotos[0];
          const rel = lead && uploadedRef.current[lead.id];
          if (!rel) throw new Error('No photo is on the website yet.');
          const res = await fetch('/api/website/featured', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ key: rel }) });
          if (!res.ok) throw httpError((await res.json().catch(() => ({}))).error || `${res.status}`, res.status);
        } else if (s.id === 'instagram') {
          if (!sentRef.current.instagram) {
            const form = new FormData();
            form.set('file', new File([await getStory()], `${fileNameBase}-story.jpg`, { type: 'image/jpeg' }));
            const res = await fetch('/api/instagram/story', { method: 'POST', headers, body: form });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw httpError(d.error || `Instagram failed (${res.status})`, res.status);
            sentRef.current.instagram = true;
          }
        } else if (s.id.startsWith('wa:')) {
          // The caption rides on the first square; the others follow without one.
          const target = s.id.slice(3);
          const ordered = waPhotos();
          for (let i = 0; i < ordered.length; i++) {
            setStep(s.id, { note: `${i + 1} of ${ordered.length}` });
            // 1600 px: WhatsApp makes no preview for images over 3000 px, and shrinks everything to about this anyway.
            await sendWhatsApp(`${s.id}:photo-${ordered[i].id}`, await squareJpeg(ordered[i], 1600), `${fileNameBase}${i ? `-${i + 1}` : ''}.jpg`, i === 0 ? caption : '', target, headers);
          }
          setStep(s.id, { note: `${ordered.length} square${ordered.length === 1 ? '' : 's'}` });
        }
        setStep(s.id, { status: 'done' });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed';
        setStep(s.id, { status: 'failed', error: message, errStatus: errStatus(e) });
        // WhatsApp and Instagram log their own failures on the server; the website goes
        // through the shared Add Photos route, so the page records those itself.
        if (s.id === 'website' || s.id === 'featured') reportError(s.id, message, errStatus(e));
        failedAny = true;
      }
    }
    setPublishing(false);
    if (failedAny) health.refresh();
  };

  /**
   * Keep this piece in the queue, exactly as it is now — its squares at the
   * website's and WhatsApp's sizes and its story, drawn here — and clear the
   * page for the next one. Nothing is sent until the queue says so.
   */
  const addToQueue = async () => {
    if (problems.length) { toast({ title: 'Not yet', description: problems.join(' '), variant: 'destructive' }); return; }
    if (!hero || !(siteOn || waOn || igOn)) { toast({ title: 'It isn’t going anywhere', description: 'Switch on the website, WhatsApp or Instagram for this piece first.' }); return; }
    // The queue sends by itself; a story that goes by hand would be lost when the page clears for the next piece.
    if (storyByHand && !storyOut) {
      toast({ title: 'Share the story first', description: 'The queue only carries what sends by itself, and this story goes from your phone. Share or save it below, then queue the post — or choose Post only.' });
      return;
    }
    // The story's photo leads on the website too: it is the one the set of the day shows.
    const site = siteOn ? [...sitePhotos.filter(p => p.id === hero.id), ...sitePhotos.filter(p => p.id !== hero.id)] : [];
    const wa = waOn ? waPhotos() : [];
    try {
      const ok = await queue.add({
        headline: headline.trim(), caption, fileBase: fileNameBase || 'piece',
        targets: {
          website: siteOn ? { folder, collection: chosen?.collection ?? folder, names: site.map((_, i) => websiteFileName(siteName || headline, i)), featured: feature && STORE_WEBSITE_FEATURED } : null,
          instagram: igOn,
          whatsapp: waOn ? waChosen : [],
        },
        site: await Promise.all(site.map(p => squareJpeg(p, siteSize(p)))),
        wa: await Promise.all(wa.map(p => squareJpeg(p, 1600))),
        story: igOn ? await getStory() : null,
        thumb: await squareJpeg(hero, 240).catch(() => null),
      });
      if (ok) {
        startOver();
        toast({ title: `“${headline.trim()}” is in the queue`, description: 'Make the next piece — then send them all, or spread them over the day.' });
      }
    } catch (e) {
      explain('page', e);
    }
  };

  /** Checks failing now for anywhere these queued pieces go. */
  const queueBlockers = (entries: { website: unknown; instagram: boolean; whatsapp: string[] }[]) => (health.report?.checks ?? []).filter(c => c.status === 'fail' && (
    (c.group === 'Website' && entries.some(e => e.website)) || (c.group === 'Instagram' && entries.some(e => e.instagram)) || (c.group === 'WhatsApp' && entries.some(e => e.whatsapp.length))));

  const onPublish = () => {
    if (problems.length) { toast({ title: 'Not yet', description: problems.join(' '), variant: 'destructive' }); return; }
    if (waOn || igOn || blockers.length) setConfirmOpen(true);
    else runPublish();
  };
  /** A story on its own that Instagram won't take by itself: the phone's share sheet is the publish. */
  const onShareOnly = () => {
    if (problems.length) { toast({ title: 'Not yet', description: problems.join(' '), variant: 'destructive' }); return; }
    shareStory();
  };

  const startOver = () => {
    photos.forEach(p => URL.revokeObjectURL(p.url));
    if (lettered) URL.revokeObjectURL(lettered.url);
    setPhotos([]); setHeroId(null); setKicker(''); setHeadline(''); setWeight(''); setWeightEach(false);
    setStones(''); setHook(''); setCaptionEdited(false); setSiteNameEdited(false); setFeature(false);
    story.reset(emptyDoc(null)); setPalette(PALETTES[0]);
    setLettering('ours'); setLettered(null); setAiCaption(null);
    setSteps([]); uploadedRef.current = {}; sentRef.current = {}; setStoryOut(false);
  };

  // Everything that sends by itself has gone; a by-hand story may still be waiting for the phone.
  const published = steps.length > 0 && steps.every(s => s.status === 'done' || s.manual);
  const grouped = useMemo(() => {
    const g = new Map<string, Collection[]>();
    for (const c of collections || []) { const a = g.get(c.category) || []; a.push(c); g.set(c.category, a); }
    return [...g.entries()];
  }, [collections]);
  const busyList = Object.values(aiBusy);

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl space-y-5">
      {/* Makes sure the story faces' @font-face rules are on the page for the canvas. */}
      <span aria-hidden className={cn(headlineFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(bodyFace.className, 'sr-only')}>.</span>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center"><Send className="mr-3 h-7 w-7" /> Post a Piece</h1>
          <p className="text-sm text-muted-foreground mt-1">One piece in — its story, its post and its caption out, sent from here.</p>
        </div>
        {busyList.length > 0 && (
          <div className="flex items-center gap-2 text-sm rounded-full bg-primary/10 text-primary px-3 py-1.5">
            <Loader2 className="h-4 w-4 animate-spin" /> {busyList[busyList.length - 1]}…{busyList.length > 1 ? ` (+${busyList.length - 1})` : ''}
          </div>
        )}
      </div>

      <FormatPicker value={formats} onChange={chooseFormats} disabled={publishing || steps.length > 0} siteName={SITE_NAME || 'the website'} />

      <HealthPanel health={health} />

      {/*
        The steps. On a phone they run in order — photos, the piece, the designs, where it goes, send —
        so the story and the post show as soon as there is a headline; on a computer the designs and
        Send sit beside the form. The two columns are `contents` on a phone, so `order` can interleave them.
      */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="contents lg:block lg:min-w-0 lg:space-y-6">
          <section className={cn(STEP, 'order-1')}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}>
            <div className="flex items-center justify-between gap-2">
              <StepTitle n={1}>Photos</StepTitle>
              {(photos.length > 0 || reading > 0) && (
                <div className="flex gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4 mr-1.5" /> Add</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => cameraRef.current?.click()} className="sm:hidden" aria-label="Take a photo"><Camera className="h-4 w-4" /></Button>
                </div>
              )}
            </div>
            {!photos.length && !reading ? (
              <div className="rounded-xl border-2 border-dashed border-muted-foreground/25 p-5 text-center">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4 mr-2" /> Choose photos</Button>
                  <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()} className="sm:hidden"><Camera className="h-4 w-4 mr-2" /> Take a photo</Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Or drag them here.</p>
              </div>
            ) : (<>
              <ul className="grid grid-cols-3 gap-2 sm:gap-3">
                {photos.map(p => (
                  <PhotoTile
                    key={p.id}
                    photo={p}
                    isHero={hero?.id === p.id}
                    starLabel={formats === 'square' ? 'Send this one first' : formats === 'story' ? 'Use for the story' : 'Lead photo: the story and the first post'}
                    locked={publishing}
                    busy={busyAny}
                    siteOn={makeSquare && toWebsite && !!SITE}
                    waOn={makeSquare && toWhatsApp && !!community}
                    tidy={tidy}
                    onTidy={setTidy}
                    onHero={() => setHeroId(p.id)}
                    onRemove={() => removePhoto(p.id)}
                    onToggle={patch => patchPhoto(p.id, patch)}
                    onEnhance={() => aiImage(p, 'enhance', { tidy }, 'Enhanced')}
                    onReframe={(aspect) => aiImage(p, 'reframe', { aspect, tidy }, aspect === '9:16' ? 'Story frame' : `Extended ${aspect}`)}
                    onRestage={(aspect) => setRestageFor({ photoId: p.id, aspect })}
                    onAsk={() => { setAskFor({ photoId: p.id, aspect: null }); setAskText(''); setAskPromptText(null); }}
                  />
                ))}
                {Array.from({ length: Math.max(0, reading) }).map((_, i) => (
                  <li key={`r${i}`} className="aspect-square rounded-lg border bg-muted/40 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></li>
                ))}
              </ul>
              {photos.length > 0 && (
                <p className="text-xs text-muted-foreground"><Star className="inline h-3 w-3 -mt-0.5" /> {formats === 'both' ? 'leads: the story’s photo and the first post' : formats === 'story' ? 'is the story' : 'goes first'} · <Sparkles className="inline h-3 w-3 -mt-0.5" /> AI on any photo</p>
              )}
            </>)}
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
          </section>

          <section className={cn(STEP, 'order-2')}>
            <StepTitle n={2}>The piece</StepTitle>
            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2.5 sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-3">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="headline">Headline</Label>
                <Input id="headline" value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Bangle & Ring" className="h-12 text-lg" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weight">Weight (g)</Label>
                <Input id="weight" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value.replace(/[^\d.]/g, ''))} onFocus={e => e.currentTarget.select()} placeholder="18.8" className="h-12 text-lg tabular-nums" />
              </div>
            </div>
            {(() => {
              const ideas = [...(aiCaption?.headlines ?? []), 'Set of the Day', chosen?.collection]
                .filter((s, i, a): s is string => !!s && s !== headline && a.indexOf(s) === i).slice(0, 4);
              return ideas.length ? (
                <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
                  {ideas.map(s => (
                    <button key={s} type="button" onClick={() => setHeadline(s)} className="shrink-0 whitespace-nowrap text-xs rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground">{s}</button>
                  ))}
                </div>
              ) : null;
            })()}
            <button type="button" onClick={() => setDetailsOpen(o => !o)} aria-expanded={detailsOpen}
              className="flex min-h-0 w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm hover:bg-muted/50">
              <span className="font-medium">More details</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{[metal, stones, kicker && `“${kicker}”`, weightEach && 'weight each'].filter(Boolean).join(' · ')}</span>
              <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', detailsOpen && 'rotate-180')} />
            </button>
            {detailsOpen && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="metal">Metal</Label>
                  <Input id="metal" value={metal} onChange={e => setMetal(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stones">Stones <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="stones" value={stones} onChange={e => setStones(e.target.value)} placeholder="Simulated Sapphires" />
                  {aiCaption?.stonesSeen && !stones && <p className="text-xs text-muted-foreground">AI sees: {aiCaption.stonesSeen}. Name them if you know.</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="kicker">Small line above the headline <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input id="kicker" value={kicker} onChange={e => setKicker(e.target.value)} placeholder="Lightweight" />
                </div>
                <label className="flex items-center gap-2 text-sm sm:self-end sm:pb-2.5"><Switch checked={weightEach} onCheckedChange={setWeightEach} /> The weight is for each piece</label>
              </div>
            )}
          </section>

          <section className={cn(STEP, 'order-4')}>
            <StepTitle n={4}>Where it goes</StepTitle>

            {makeSquare && SITE && (
              <div className="rounded-xl bg-muted/40 p-3 space-y-2.5">
                <label className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 font-medium"><Globe className="h-4 w-4 shrink-0" /> <span className="truncate">{SITE_NAME}</span><span className="shrink-0 text-muted-foreground font-normal text-xs">· {sitePhotos.length} photo{sitePhotos.length === 1 ? '' : 's'}</span></span>
                  <Switch checked={toWebsite} onCheckedChange={setToWebsite} />
                </label>
                {toWebsite && (<>
                  {!uploadsOn && <p className="text-sm text-amber-600">Uploads are not switched on for this shop (WEBSITE_UPLOAD_SECRET).</p>}
                  <Select value={folder} onValueChange={setFolder} recentsKey="website-collection">
                    <SelectTrigger className="h-11"><SelectValue placeholder={collections ? 'Which collection?' : 'Loading collections…'} /></SelectTrigger>
                    <SelectContent>
                      {grouped.map(([category, list]) => (
                        <SelectGroup key={category}>
                          <SelectLabel>{category}</SelectLabel>
                          {list.map(c => <SelectItem key={c.folder} value={c.folder}>{c.collection}</SelectItem>)}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <label className="flex items-center gap-2"><Switch checked={weightStamped} disabled={!wLabel}
                      onCheckedChange={v => square.change(d => ({ ...d, layers: d.layers.map(l => l.kind === 'text' && l.bind === 'weight' ? { ...l, hidden: !v } : l) }))} /> {wLabel || 'Weight'} on the photo</label>
                    {STORE_WEBSITE_FEATURED && <label className="flex items-center gap-2"><Switch checked={feature} onCheckedChange={setFeature} /> Set of the day</label>}
                  </div>
                  {renameOpen ? (
                    <div className="space-y-1">
                      <Label htmlFor="sitename" className="text-xs">Name on the website</Label>
                      <Input id="sitename" value={siteName} onChange={e => { setSiteName(e.target.value); setSiteNameEdited(true); }} placeholder={chosen?.collection ?? 'Piece name'} autoFocus />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground truncate">Named “{siteName || headline || '…'}” · <button type="button" className="text-primary" onClick={() => setRenameOpen(true)}>Change</button></p>
                  )}
                </>)}
              </div>
            )}

            {makeSquare && community && (
              <div className="rounded-xl bg-muted/40 p-3 space-y-2.5">
                <label className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 font-medium"><MessageCircle className="h-4 w-4 shrink-0" /> <span className="truncate">{community.name}</span>{community.size ? <span className="shrink-0 text-muted-foreground font-normal text-xs">· {community.size.toLocaleString()}</span> : null}</span>
                  <Switch checked={toWhatsApp} onCheckedChange={setToWhatsApp} />
                </label>
                {!community.reachable && <p className="text-sm text-amber-600">The WhatsApp line did not answer just now. Sending may fail; check Settings → Integrations.</p>}
                {toWhatsApp && (waGroups.length > 1 || waChannel) && (
                  // Where it goes: any of the community's groups, the channel, or both — each its own tick.
                  <div className="flex flex-wrap gap-1.5">
                    {[...waGroups.map(g => ({ key: g.key, label: g.label, n: g.size, channel: false })), ...(waChannel ? [{ key: 'channel', label: 'Channel', n: waChannel.followers, channel: true }] : [])].map(o => {
                      const on = waTargets.includes(o.key);
                      return (
                        <button key={o.key} type="button" disabled={publishing} aria-pressed={on} title={`${waName(o.key)}${waReach(o.key) ? ` — ${waReach(o.key)}` : ''}`}
                          onClick={() => setWaTargets(t => on ? t.filter(k => k !== o.key) : [...t, o.key])}
                          className={cn('min-h-0 rounded-full border px-2.5 py-1 text-xs inline-flex items-center gap-1', on ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>
                          {o.channel ? <Radio className="h-3 w-3" /> : on ? <Check className="h-3 w-3" /> : null}
                          {o.label}{o.n ? <span className="tabular-nums opacity-60">{o.n.toLocaleString()}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
                {toWhatsApp && (!waPhotos().length || !waChosen.length || waPhotos().length > 1) && (
                  <p className="text-xs text-muted-foreground">
                    {!waPhotos().length ? 'Tick WA on a photo to send it.'
                      : !waChosen.length ? 'Choose where it goes.'
                      : `${waPhotos().length} photos — the caption rides on the first.`}
                  </p>
                )}
              </div>
            )}

            {makeSquare && !community && (
              // Never just gone: say why there's nothing to tick.
              <div className="rounded-xl border border-dashed p-3 space-y-1">
                <span className="flex items-center gap-2 font-medium text-muted-foreground"><MessageCircle className="h-4 w-4" /> WhatsApp</span>
                <p className="text-xs text-muted-foreground">
                  {waState === 'loading' ? 'Loading the groups and the channel…'
                    : waState === 'error' ? 'Couldn’t load the WhatsApp groups just now — reload the page, or sign in again.'
                    : 'This copy of the POS has no WhatsApp settings, so it can’t send here (the live POS can). Share the post from your phone under Send.'}
                </p>
              </div>
            )}

            {makeStory && (
              <div className="rounded-xl bg-muted/40 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 font-medium"><Instagram className="h-4 w-4 shrink-0" /> <span className="truncate">Instagram story</span>{ig?.connected && <span className="shrink-0 truncate text-muted-foreground font-normal text-xs">· @{ig.username}</span>}</span>
                  {ig?.connected ? <Switch checked={toInstagram} onCheckedChange={setToInstagram} /> : null}
                </div>
                {ig?.connected && !toInstagram && <p className="text-xs text-muted-foreground">Off — you’ll share it from your phone instead, to add music or stickers.</p>}
                {!ig?.connected && (
                  ig?.configured
                    ? <Button variant="outline" size="sm" onClick={connectInstagram}><Link2 className="h-4 w-4 mr-1.5" /> Connect Instagram</Button>
                    : <p className="text-xs text-muted-foreground">Not connected to this shop&apos;s Instagram — the story is shared from your phone.</p>
                )}
              </div>
            )}

            {makeSquare && <div className="space-y-1.5 border-t pt-4">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="caption">WhatsApp caption</Label>
                <div className="flex items-center gap-3">
                  {captionEdited && <button type="button" className="min-h-0 text-xs text-muted-foreground" onClick={() => { setCaptionEdited(false); setAiCaption(null); }}>Plain version</button>}
                  <Button type="button" size="sm" variant="secondary" onClick={() => writeWithAi()} disabled={!hero || !!aiBusy.caption}>
                    {aiBusy.caption ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />} Write with AI
                  </Button>
                </div>
              </div>
              {(hookOpen || hook) && <Input value={hook} onChange={e => setHook(e.target.value)} placeholder="One line about it — goes under the header" autoFocus={hookOpen && !hook} />}
              <Textarea id="caption" value={caption} onChange={e => { setCaption(e.target.value); setCaptionEdited(true); }} rows={6} className="font-mono text-sm" placeholder="Type a headline and the caption writes itself — or let AI write it from the photo." />
              {!hookOpen && !hook && <button type="button" className="min-h-0 text-xs text-primary" onClick={() => setHookOpen(true)}>+ A line about it</button>}
              {aiCaption?.instagramCaption && (
                <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between"><span className="font-medium">Instagram feed caption (AI)</span><button type="button" className="text-primary inline-flex items-center gap-1" onClick={() => copyText(aiCaption.instagramCaption, 'Instagram caption')}><Copy className="h-3 w-3" /> Copy</button></div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{aiCaption.instagramCaption}</p>
                </div>
              )}
            </div>}
          </section>
        </div>

        <aside className="contents lg:block lg:min-w-0 lg:space-y-6 lg:sticky lg:top-4 lg:self-start">
          {(() => {
            const current = squarePhotos.find(p => p.id === square.doc.bg.photoId) ?? squarePhotos[0];
            const notSquare = current && Math.abs(current.img.naturalWidth / current.img.naturalHeight - 1) > 0.02;
            const squareGoes = listOf([waOn && 'WhatsApp', siteOn && SITE_NAME].filter((x): x is string => !!x));
            const aiTrigger = (
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={busyAny}>
                  {busyAny ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />} AI
                </Button>
              </DropdownMenuTrigger>
            );
            const tidyItem = <DropdownMenuCheckboxItem checked={tidy} onCheckedChange={v => setTidy(!!v)} onSelect={e => e.preventDefault()}>Also remove tags and strings</DropdownMenuCheckboxItem>;
            return (
              <section ref={editorRef} className={cn(STEP, 'order-3 scroll-mt-20')}>
                <StepTitle n={3}>{formats === 'both' ? 'The story and the post' : formats === 'story' ? 'The story' : 'The post'}</StepTitle>
                <PairEditor
                  show={formats === 'both' ? ['story', 'square'] : formats === 'story' ? ['story'] : ['square']}
                  active={view}
                  onActive={setView}
                  story={{
                    label: 'Story',
                    sub: igOn ? 'Instagram, by itself' : 'Instagram, from your phone',
                    placeholder: hero ? undefined : (
                      <p className="rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">Add a photo and the story appears here.</p>
                    ),
                    tools: hero ? (
                      <DropdownMenu>
                        {aiTrigger}
                        <DropdownMenuContent align="start" className="w-64">
                          <DropdownMenuLabel>AI — the piece stays as it is</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => setWholeOpen(true)}><Wand2 className="h-4 w-4 mr-2" /> Make the whole story…</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRestageFor({ photoId: (hero.ai && photos.find(p => p.id === hero.ai!.parentId)?.id) || hero.id, aspect: '9:16' })}><PaletteIcon className="h-4 w-4 mr-2" /> New setting…</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => aiImage(hero, 'reframe', { aspect: '9:16', tidy }, 'Story frame')}><Expand className="h-4 w-4 mr-2" /> Extend the photo to 9:16</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setAskFor({ photoId: hero.id, aspect: null }); setAskText(''); setAskPromptText(null); }}><MessageSquareText className="h-4 w-4 mr-2" /> Ask AI…</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {lettering === 'ai'
                            ? <DropdownMenuItem onClick={() => setLettering('ours')}><Type className="h-4 w-4 mr-2" /> Back to our fonts</DropdownMenuItem>
                            : <DropdownMenuItem disabled={!headline.trim()} onClick={() => { setLettering('ai'); if (!aiLettered) letterWithAi(); }}><Type className="h-4 w-4 mr-2" /> AI lettering</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          {tidyItem}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null,
                    bottom: lettering === 'ai' ? (
                      <div className="rounded-xl bg-muted/40 p-3 space-y-2 text-sm">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-medium flex-1">AI lettering</span>
                          <button type="button" onClick={letterWithAi} disabled={busyAny || !headline.trim()} className="min-h-0 text-xs text-primary inline-flex items-center gap-1"><Type className="h-3 w-3" /> {aiLettered ? 'Letter again' : 'Letter it'}</button>
                          <button type="button" onClick={() => setLettering('ours')} className="min-h-0 text-xs text-muted-foreground">Back to our fonts</button>
                        </div>
                        <Input value={letterStyle} onChange={e => setLetterStyle(e.target.value)} placeholder="Style, in your words (optional) — e.g. gold foil serif" className="h-8 text-xs" />
                        {aiLettered && (
                          <p className={cn('text-xs flex items-center gap-1', aiLettered.verified ? 'text-emerald-600' : 'text-amber-600')}>
                            {aiLettered.verified ? <><ShieldCheck className="h-3.5 w-3.5" /> Read back: every word and the weight are right.</> : <><ShieldAlert className="h-3.5 w-3.5" /> Could not read: {aiLettered.missing.join(', ')}. Check it or use our fonts.</>}
                          </p>
                        )}
                      </div>
                    ) : null,
                    props: {
                      api: story, fields, assets,
                      photos: photos.map(p => ({ id: p.id, url: p.url, label: p.ai?.label })),
                      palette, onPalette: setPalette,
                      lettered: aiLettered?.img ?? null,
                      onField, weightOwnLine,
                      websiteLabel: SITE_NAME || 'taheri.shop',
                      presets: PRESETS,
                      onPreset: id => story.change(d => applyPreset(d, id as PresetId, palette, fields, assets, { weightOwnLine, wordmark: d.layers.some(l => l.kind === 'wordmark') || d.layers.length === 0 })),
                      previewPreset: id => applyPreset(story.doc, id as PresetId, palette, fields, assets, { weightOwnLine, wordmark: story.doc.layers.some(l => l.kind === 'wordmark') || story.doc.layers.length === 0 }),
                      fileName: fileNameBase,
                      overlay: (aiBusy.whole || aiBusy.letter) ? (
                        <div className="absolute inset-0 rounded-xl bg-black/45 text-white flex flex-col items-center justify-center gap-2 text-sm text-center p-6">
                          <Loader2 className="h-6 w-6 animate-spin" />{aiBusy.whole ? 'Writing, choosing a setting and photographing it… about a minute' : 'Lettering it and reading it back…'}
                        </div>
                      ) : null,
                    },
                  }}
                  square={{
                    label: 'Post',
                    sub: `Square · ${squareGoes || `WhatsApp + ${SITE_NAME || 'website'}`}`,
                    placeholder: squarePhotos.length ? undefined : (
                      <p className="rounded-xl border-2 border-dashed p-6 text-center text-sm text-muted-foreground">{photos.length ? 'Tick Site or WA on a photo and the post appears here.' : 'Add a photo and the post appears here.'}</p>
                    ),
                    top: notSquare ? <p className="text-xs text-amber-600">This photo isn’t square, so its edges are cropped — drag it on the post, or AI → Make it a true square.</p> : null,
                    tools: current ? (
                      <DropdownMenu>
                        {aiTrigger}
                        <DropdownMenuContent align="start" className="w-64">
                          <DropdownMenuLabel>AI — the piece stays as it is</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => aiImage(current, 'reframe', { aspect: '1:1', tidy }, 'Square')}><Expand className="h-4 w-4 mr-2" /> Make it a true square</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => aiImage(current, 'enhance', { tidy }, 'Enhanced')}><Sparkles className="h-4 w-4 mr-2" /> Enhance the photo</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setAskFor({ photoId: current.id, aspect: '1:1' }); setAskText(''); setAskPromptText(null); }}><MessageSquareText className="h-4 w-4 mr-2" /> Ask AI…</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {tidyItem}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null,
                    props: {
                      api: square, square: true, fields, assets,
                      photos: squarePhotos.map(p => ({ id: p.id, url: p.url, label: p.ai?.label })),
                      palette, onPalette: setPalette,
                      lettered: null,
                      onField, weightOwnLine,
                      websiteLabel: SITE_NAME || 'taheri.shop',
                      presets: SQUARE_PRESETS,
                      onPreset: id => square.change(d => applySquarePreset(d, id as SquarePresetId, fields, assets)),
                      previewPreset: id => applySquarePreset(square.doc, id as SquarePresetId, fields, assets),
                      fileName: fileNameBase,
                    },
                  }}
                />
              </section>
            );
          })()}

          <section className={cn(STEP, 'order-5')}>
            <StepTitle n={5}>Send</StepTitle>
            <QueuePanel api={queue} destinationName={waName} blockers={queueBlockers} />

            <div className="space-y-3">
              {steps.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {steps.map(s => (
                    <li key={s.id} className="flex items-start gap-2">
                      <span className="mt-0.5">
                        {s.status === 'done' ? <Check className="h-4 w-4 text-emerald-600" /> : s.status === 'failed' ? <X className="h-4 w-4 text-destructive" /> : s.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : s.manual ? <Instagram className="h-4 w-4 text-muted-foreground" /> : <span className="block h-4 w-4 rounded-full border" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{s.label}{s.note ? <span className="text-muted-foreground"> · {s.note}</span> : null}</span>
                        {s.error && (() => {
                          const d = diagnose(whereOfStep(s.id), { status: s.errStatus, message: s.error }, dctx);
                          return (
                            <span className="block mt-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 space-y-1">
                              <span className="block text-xs font-semibold text-destructive">{d.title}</span>
                              <span className="block text-xs">{d.fix}</span>
                              {d.action && <ActionButton action={d.action} />}
                            </span>
                          );
                        })()}
                      </span>
                      {s.status === 'failed' && !publishing && <button type="button" onClick={() => runPublish(s.id)} className="text-xs text-primary flex items-center gap-1"><RotateCw className="h-3 w-3" /> Retry</button>}
                      {s.manual && s.status !== 'done' && <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={shareStory}><Share2 className="h-3.5 w-3.5 mr-1" /> Share</Button>}
                    </li>
                  ))}
                </ul>
              )}
              {!published ? (<>
                {targets.length === 0 && storyByHand ? (
                  // A story on its own that Instagram won't take by itself: the share sheet is the publish.
                  <Button className="w-full h-12 text-base" onClick={onShareOnly} disabled={busyAny || !ready}>
                    <Share2 className="h-4 w-4 mr-2" /> Share the story
                  </Button>
                ) : (
                  <Button className="w-full h-12 text-base" onClick={onPublish} disabled={publishing || busyAny || !ready || targets.length === 0 || steps.length > 0 || !!queue.adding}>
                    {publishing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Publishing…</> : <><Send className="h-4 w-4 mr-2" /> Publish{targets.length ? ` to ${targets.join(' + ')}` : ''}</>}
                  </Button>
                )}
                {targets.length > 0 && storyByHand && steps.length === 0 && (
                  <p className="text-xs text-muted-foreground flex items-start gap-1.5"><Instagram className="h-3.5 w-3.5 mt-px shrink-0" /> Then the story, from your phone — it’s the last step after Publish.</p>
                )}
                {/* Several pieces in one go: keep this one, make the next, send them together or through the day. */}
                {steps.length === 0 && targets.length > 0 && (
                  <Button variant="outline" className="w-full" onClick={addToQueue} disabled={publishing || busyAny || !ready || targets.length === 0 || !!queue.adding}>
                    {queue.adding ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {queue.adding}</> : <><ListPlus className="h-4 w-4 mr-2" /> Add to queue{queue.items.some(e => e.status === 'held' || e.status === 'scheduled' || e.status === 'failed') ? '' : ' — send later'}</>}
                  </Button>
                )}
              </>) : (
                <Button variant="outline" className="w-full" onClick={startOver}>Post another piece</Button>
              )}
              {!ready && <p className="text-xs text-muted-foreground">{problems.slice(0, 2).join(' ')}</p>}

              {/* From the phone: the one thing most often wanted, and the rest in a menu. */}
              {(() => {
                const main = formats === 'both'
                  ? { label: `Save story + post${squarePhotos.length > 1 ? 's' : ''}`, icon: <Download className="h-4 w-4 mr-1.5" />, run: saveBoth, off: !ready || !squarePhotos.length }
                  : formats === 'story'
                    ? { label: 'Save the story', icon: <Download className="h-4 w-4 mr-1.5" />, run: saveStory, off: !ready }
                    : { label: waChannel ? 'Share the post' : 'Share to the channel', icon: <Share2 className="h-4 w-4 mr-1.5" />, run: shareToChannel, off: !ready };
                return (
                  <div className="flex items-center gap-2 border-t pt-3">
                    <span className="hidden text-xs text-muted-foreground sm:inline lg:hidden xl:inline">Phone:</span>
                    <Button variant="secondary" size="sm" className="flex-1" disabled={main.off} onClick={main.run}>{main.icon}{main.label}</Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="outline" size="sm" aria-label="More ways to share"><MoreHorizontal className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">More</span></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {makeStory && <DropdownMenuItem disabled={!ready} onClick={shareStory}><Instagram className="h-4 w-4 mr-2" /> Share the story</DropdownMenuItem>}
                        {makeStory && formats !== 'story' && <DropdownMenuItem disabled={!ready} onClick={saveStory}><Download className="h-4 w-4 mr-2" /> Save the story</DropdownMenuItem>}
                        {/* With the channel posted automatically, sharing by hand would post it twice: this is a plain share. */}
                        {makeSquare && formats !== 'square' && <DropdownMenuItem disabled={!ready} onClick={shareToChannel}><Share2 className="h-4 w-4 mr-2" /> {waChannel ? 'Share the post' : 'Share to the channel'}</DropdownMenuItem>}
                        {makeSquare && <DropdownMenuItem disabled={!caption} onClick={() => copyText(caption, 'Caption')}><Copy className="h-4 w-4 mr-2" /> Copy the caption</DropdownMenuItem>}
                        {makeSquare && STORE_LINKS.waChannel && (
                          <DropdownMenuItem asChild><a href={STORE_LINKS.waChannel} target="_blank" rel="noopener"><ExternalLink className="h-4 w-4 mr-2" /> Open the WhatsApp channel</a></DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })()}
            </div>
          </section>
        </aside>
      </div>

      {/* A new setting for a photo. */}
      <Dialog open={!!restageFor} onOpenChange={o => { if (!o) setRestageFor(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Put it somewhere new</DialogTitle>
            <DialogDescription>The piece stays exactly as photographed; AI photographs it again in the setting you choose, then checks it is still the same piece.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {SCENES.map(s => (
              <button key={s.id} type="button" onClick={() => { setSceneId(s.id); setCustomScene(''); }}
                className={cn('rounded-lg border p-2.5 text-left text-sm', sceneId === s.id && !customScene.trim() ? 'border-primary bg-primary/5' : 'hover:border-foreground/30')}>
                <span className="font-medium block">{s.label}</span>
                <span className="text-xs text-muted-foreground">For {s.suits}</span>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-scene" className="text-xs">Or describe one</Label>
            <Input id="custom-scene" value={customScene} onChange={e => setCustomScene(e.target.value)} placeholder="on a marble tray beside white roses, morning light" />
          </div>
          {restageFor && (
            <Seg value={restageFor.aspect} options={[['9:16', 'Story 9:16'], ['4:5', 'Portrait 4:5'], ['1:1', 'Square']]} onChange={v => setRestageFor(r => r && { ...r, aspect: v as Aspect })} />
          )}
          {restageFor && (
            <PromptEditor
              value={restagePromptText}
              generated={restagePrompt(customScene.trim() || SCENES.find(s => s.id === sceneId)?.brief || '', restageFor.aspect)}
              onChange={setRestagePromptText}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setRestageFor(null); setRestagePromptText(null); }}>Cancel</Button>
            <Button onClick={runRestage}><Sparkles className="h-4 w-4 mr-1.5" /> Photograph it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ask AI: anything, in the counter's words. */}
      <Dialog open={!!askFor} onOpenChange={o => { if (!o) { setAskFor(null); setAskPromptText(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask AI to change this photo</DialogTitle>
            <DialogDescription>Say it the way you’d tell a photographer. The piece itself is protected, and the result is checked against the original.</DialogDescription>
          </DialogHeader>
          {askFor && (() => { const src = photos.find(p => p.id === askFor.photoId); return src ? <img src={src.url} alt="" className="h-28 w-28 object-cover rounded-md mx-auto" /> : null; })()}
          <Textarea value={askText} onChange={e => setAskText(e.target.value)} rows={3} autoFocus
            placeholder="e.g. put it on white marble with a few rose petals · remove the hand · warmer evening light · make the background deep green velvet" />
          <div className="flex flex-wrap gap-1.5">
            {['Remove the hand and props', 'Warmer, golden-hour light', 'Deep green velvet background', 'Soft bokeh lights behind', 'Clean white studio background', 'Add a subtle reflection below'].map(t => (
              <button key={t} type="button" onClick={() => setAskText(t)} className="text-xs rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground">{t}</button>
            ))}
          </div>
          {askFor && (
            <Seg value={askFor.aspect ?? 'same'} options={[['same', 'Same shape'], ['9:16', 'Story 9:16'], ['4:5', 'Portrait 4:5'], ['1:1', 'Square']]} onChange={v => setAskFor(a => a && { ...a, aspect: v === 'same' ? null : v as Aspect })} />
          )}
          {askFor && <PromptEditor value={askPromptText} generated={customPrompt(askText || '…', askFor.aspect)} onChange={setAskPromptText} />}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAskFor(null); setAskPromptText(null); }}>Cancel</Button>
            <Button onClick={runAsk} disabled={!askText.trim() && !askPromptText?.trim()}><Sparkles className="h-4 w-4 mr-1.5" /> Do it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Make it with AI: optionally steered by a brief. */}
      <Dialog open={wholeOpen} onOpenChange={setWholeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Make the story with AI</DialogTitle>
            <DialogDescription>AI writes the headline and captions, picks the colours and layout, and photographs the piece in a setting for a 9:16 story. Tell it what you have in mind, or leave it to choose.</DialogDescription>
          </DialogHeader>
          <Textarea value={wholeBrief} onChange={e => setWholeBrief(e.target.value)} rows={4}
            placeholder="Optional — e.g. Eid collection, festive green and gold, on a carved wooden jewellery box with marigolds · or: minimal, for everyday wear, soft morning light" />
          <div className="flex flex-wrap gap-1.5">
            {['Eid collection, festive green and gold', 'Wedding season, rich and regal', 'Everyday wear, light and minimal', 'For her birthday, soft and romantic', 'Heritage piece, old-world and warm'].map(t => (
              <button key={t} type="button" onClick={() => setWholeBrief(t)} className="text-xs rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground">{t}</button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setWholeOpen(false)}>Cancel</Button>
            <Button onClick={() => { setWholeOpen(false); makeWholeStory(wholeBrief); }}><Wand2 className="h-4 w-4 mr-1.5" /> Make it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post it now?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1.5">
                {igOn && <p>The story goes up on Instagram as @{ig?.username}.</p>}
                {waOn && (
                  <div>
                    <p>{waPhotos().length} square photo{waPhotos().length === 1 ? '' : 's'} with the caption go{waPhotos().length === 1 ? 'es' : ''} to:</p>
                    <ul className="text-xs mt-0.5">{waChosen.map(k => <li key={k}>{waName(k)}{k === 'channel' ? ' (channel)' : ''}{waReach(k) ? ` — ${waReach(k)}` : ''}</li>)}</ul>
                  </div>
                )}
                {siteOn && <p>{sitePhotos.length} square photo{sitePhotos.length === 1 ? '' : 's'} go{sitePhotos.length === 1 ? 'es' : ''} on {SITE_NAME}.</p>}
                {storyByHand && <p>Then share the story from your phone — it’s the last step.</p>}
                <p>A post cannot be unsent from here.</p>
                {blockers.length > 0 && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-2 text-foreground">
                    <p className="font-semibold text-destructive">This will probably fail:</p>
                    {blockers.map(c => <p key={c.id} className="text-xs"><span className="font-medium">{c.label}</span> — {c.fix ?? c.detail}</p>)}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); runPublish(); }}>{blockers.length ? 'Publish anyway' : 'Publish'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One photo: star for the story, AI actions, where it goes, and — for AI photos — whether it is still the same piece. */
function PhotoTile({ photo: p, isHero, starLabel, locked, busy, siteOn, waOn, tidy, onTidy, onHero, onRemove, onToggle, onEnhance, onReframe, onRestage, onAsk }: {
  photo: Photo; isHero: boolean; starLabel: string; locked: boolean; busy: boolean; siteOn: boolean; waOn: boolean;
  tidy: boolean; onTidy: (v: boolean) => void;
  onHero: () => void; onRemove: () => void; onToggle: (patch: Partial<Photo>) => void;
  onEnhance: () => void; onReframe: (a: Aspect) => void; onRestage: (a: Aspect) => void; onAsk: () => void;
}) {
  const c = p.ai?.check;
  return (
    <li className={cn('rounded-lg overflow-hidden border-2 bg-muted/30', isHero ? 'border-amber-500' : 'border-transparent')}>
      <div className="relative aspect-square">
        <img src={p.url} alt="" className="w-full h-full object-cover" />
        <button type="button" onClick={onHero} aria-label={starLabel} title={starLabel} className={cn('absolute bottom-1.5 left-1.5 h-7 w-7 rounded-full flex items-center justify-center', isHero ? 'bg-amber-500 text-black' : 'bg-black/55 text-white')}>
          <Star className={cn('h-4 w-4', isHero && 'fill-current')} />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={busy || locked} aria-label="AI" className="absolute bottom-1.5 right-1.5 h-7 px-2 rounded-full bg-black/60 text-white flex items-center gap-1 text-xs disabled:opacity-50"><Sparkles className="h-3.5 w-3.5" /> AI</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>AI — the piece stays as it is</DropdownMenuLabel>
            <DropdownMenuItem onClick={onEnhance}>Enhance — clean, colour, sparkle</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onReframe('9:16')}>Extend to story (9:16)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onReframe('4:5')}>Extend to portrait (4:5)</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onReframe('1:1')}>Extend to square</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onRestage('9:16')}>New setting…</DropdownMenuItem>
            <DropdownMenuItem onClick={onAsk}>Ask AI… (anything, in your words)</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={tidy} onCheckedChange={v => onTidy(!!v)} onSelect={e => e.preventDefault()}>Also remove tags and strings</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!locked && (
          <button type="button" onClick={onRemove} aria-label="Remove" className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center"><X className="h-3.5 w-3.5" /></button>
        )}
        {p.ai && (
          <span className="absolute top-1.5 left-1.5 rounded-full bg-black/60 text-white text-[10px] px-2 py-0.5 flex items-center gap-1"><Sparkles className="h-3 w-3" />{p.ai.label}</span>
        )}
      </div>
      <div className="p-2 space-y-1.5">
        {p.ai && (
          <p title={c?.differences.join('\n') || ''} className={cn('text-[11px] flex items-start gap-1', checkOk(c) ? 'text-emerald-600' : 'text-amber-600')}>
            {checkOk(c) ? <><ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Same piece</> : <><ShieldAlert className="h-3.5 w-3.5 shrink-0" /> {c ? (c.differences[0] ?? 'Look closely') : 'Not checked'}</>}
          </p>
        )}
        <div className="flex gap-1.5">
          {siteOn && (
            <button type="button" onClick={() => onToggle({ toSite: !p.toSite })} className={cn('flex-1 rounded-full border px-2 py-0.5 text-[11px] inline-flex items-center justify-center gap-1', p.toSite ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}><Globe className="h-3 w-3" /> Site</button>
          )}
          {waOn && (
            <button type="button" onClick={() => onToggle({ toWhatsApp: !p.toWhatsApp })} className={cn('flex-1 rounded-full border px-2 py-0.5 text-[11px] inline-flex items-center justify-center gap-1', p.toWhatsApp ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground')}><MessageCircle className="h-3 w-3" /> WA</button>
          )}
        </div>
      </div>
    </li>
  );
}

/** A two- or three-way switch as a row of pills. */
function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-full border p-0.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={cn('rounded-full px-3 py-1 text-xs', value === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{label}</button>
      ))}
    </div>
  );
}

/**
 * The full prompt, shown and editable. Closed, the page sends what it built
 * from the choices above; opened and edited, it sends exactly this text.
 */
function PromptEditor({ value, generated, onChange }: { value: string | null; generated: string; onChange: (v: string | null) => void }) {
  const open = value !== null;
  return (
    <div className="space-y-1.5">
      <button type="button" className="text-xs text-primary" onClick={() => onChange(open ? null : generated)}>
        {open ? 'Use the built prompt instead' : 'Edit the full prompt (advanced)'}
      </button>
      {open && (
        <Textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={8} className="font-mono text-[11px] leading-snug" />
      )}
    </div>
  );
}

/** What the piece becomes: a story and a post (the usual), or only one of them. */
function FormatPicker({ value, onChange, disabled, siteName }: { value: Formats; onChange: (f: Formats) => void; disabled?: boolean; siteName: string }) {
  const story = <span aria-hidden className="inline-block h-[18px] w-[11px] rounded-[2px] border-2 border-current" />;
  const post = <span aria-hidden className="inline-block h-[14px] w-[14px] rounded-[2px] border-2 border-current" />;
  const options: [Formats, string, string, React.ReactNode][] = [
    ['both', 'Story + post', `Instagram · WhatsApp · ${siteName}`, <>{story}{post}</>],
    ['story', 'Story only', 'Instagram', story],
    ['square', 'Post only', `WhatsApp · ${siteName}`, post],
  ];
  return (
    <div role="radiogroup" aria-label="What are you making?" className="grid grid-cols-3 gap-1 rounded-xl border bg-muted/30 p-1">
      {options.map(([v, label, sub, icon]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}
          className={cn('flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-center disabled:opacity-50 sm:flex-row sm:justify-start sm:gap-3 sm:px-3 sm:text-left',
            value === v ? 'bg-background text-foreground shadow-sm ring-1 ring-primary' : 'text-muted-foreground hover:text-foreground')}>
          <span className={cn('flex h-5 shrink-0 items-end gap-1', value === v && 'text-primary')}>{icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight">{label}</span>
            <span className="hidden truncate text-[11px] leading-tight text-muted-foreground sm:block">{sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** A step: a card of its own, so the five read apart at a glance. */
const STEP = 'min-w-0 space-y-4 rounded-2xl border bg-card p-3.5 shadow-sm sm:p-5';

/** A step's heading: its number in a badge, and its name. */
function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 text-base font-semibold">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">{n}</span>
      {children}
    </h2>
  );
}
