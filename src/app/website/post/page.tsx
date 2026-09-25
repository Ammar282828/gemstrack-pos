'use client';

/**
 * Post a Piece — one piece, everywhere it goes, from one screen.
 *
 * The counter has photographed something new. Here they add the photos, type
 * the weight and a headline once, and the page makes everything else from
 * that: the Instagram story in the shop's own style, the WhatsApp caption, and
 * the website photo with the weight stamped in the corner. One press then
 * sends it all — the website, the set of the day, the WhatsApp community, the
 * Instagram story — and hands the WhatsApp channel (which has no API) to the
 * phone's share sheet.
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
import { Sofia_Sans_Extra_Condensed, Figtree, Bodoni_Moda } from 'next/font/google';
import { auth as firebaseAuth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import {
  Send, ImagePlus, Camera, X, Star, Loader2, Check, RotateCw, Share2, Download, Copy, ExternalLink, Instagram,
  MessageCircle, Globe, Sparkles, Wand2, Expand, Palette as PaletteIcon, Type, ShieldCheck, ShieldAlert, Link2, MessageSquareText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_LINKS, STORE_LOGO_URL, STORE_LOGO_LIGHT_URL, STORE_WEBSITE_FEATURED, STORE_WHATSAPP_NUMBERS, STORE_POST_METAL, STORE_STAMP_LINES } from '@/lib/store-config';
import { detailsLine, waNumberFromUrl, weightLabel, websiteFileName, whatsappCaption } from '@/lib/social/caption';
import { PALETTES, STORY_H, STORY_W, canvasToJpeg, loadImage, loadStampFont, stampPhoto, suggestPalette } from '@/lib/social/story';
import { SCENES, customPrompt, restagePrompt, type Aspect, type CaptionResult, type CheckResult } from '@/lib/social/prompts';
import { PRESETS, SQUARE_PRESETS, applyPreset, applySquarePreset, emptyDoc, emptySquare, reflow, renderDoc, renderDocTo, type Assets, type Bind, type Fields, type PresetId, type SquarePresetId, type StoryDoc, type TextLayer } from '@/lib/social/editor';
import type { Palette } from '@/lib/social/palettes';
import { StoryEditor, useStoryDoc } from './story-editor';
import { diagnose, type Where } from '@/lib/social/diagnose';
import { HealthPanel, useHealth, reportError, ActionButton, type Check as HealthCheck } from './health-panel';

const headlineFace = Sofia_Sans_Extra_Condensed({ subsets: ['latin'], weight: ['800'], display: 'swap' });
const bodyFace = Figtree({ subsets: ['latin'], weight: ['300', '400', '700'], display: 'swap' });
const serifFace = Bodoni_Moda({ subsets: ['latin'], weight: ['400', '500'], style: ['normal', 'italic'], display: 'swap' });
const FONTS = { headline: headlineFace.style.fontFamily, body: bodyFace.style.fontFamily, serif: serifFace.style.fontFamily };
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
interface Step { id: string; label: string; status: StepStatus; error?: string; errStatus?: number; note?: string }
const STEP_WHERE: Record<string, Where> = { website: 'website', featured: 'featured', whatsapp: 'whatsapp', instagram: 'instagram' };
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

export default function PostAPiecePage() {
  const { toast } = useToast();
  const health = useHealth();
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
  const [view, setView] = useState<'story' | 'square'>('story');
  const [feature, setFeature] = useState(false);
  const [community, setCommunity] = useState<{ name: string; size: number | null; reachable: boolean } | null>(null);
  const [toWhatsApp, setToWhatsApp] = useState(false);
  const [caption, setCaption] = useState('');
  const [captionEdited, setCaptionEdited] = useState(false);
  const [ig, setIg] = useState<{ configured: boolean; connected: boolean; username: string | null } | null>(null);
  const [toInstagram, setToInstagram] = useState(false);

  // ── Publishing ──
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [publishing, setPublishing] = useState(false);
  const uploadedRef = useRef<Record<string, string>>({});   // photo id → website rel, so a retry never uploads twice
  const sentRef = useRef<Record<string, boolean>>({});        // WhatsApp message key → sent

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [marks, setMarks] = useState<{ dark: HTMLImageElement; light: HTMLImageElement } | null>(null);
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
  const assets: Assets = useMemo(() => ({ photos: Object.fromEntries(photos.map(p => [p.id, p.img])), wordmark: marks, fonts: FONTS, stamp: STORE_STAMP_LINES }), [photos, marks]);
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
    ]).catch(() => undefined).then(() => setFontsReady(true));
    Promise.all([loadImage(STORE_LOGO_URL), loadImage(STORE_LOGO_LIGHT_URL)])
      .then(([dark, light]) => setMarks({ dark, light }))
      .catch(() => setMarks(null));
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
      const res = await fetch('/api/website/post', { headers: await authHeaders(), cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      if (d.community) { setCommunity(d.community); setToWhatsApp(true); }
    })();
  }, [toast]);
  useEffect(() => { if (folder) try { localStorage.setItem('taheri_post_folder', folder); } catch { /* fine */ } }, [folder]);

  // The website name follows the headline until someone types their own.
  useEffect(() => {
    if (siteNameEdited) return;
    const generic = !headline.trim() || /^set of the day$/i.test(headline.trim());
    setSiteName(generic ? (chosen?.collection ?? '') : headline.trim());
  }, [headline, chosen, siteNameEdited]);

  // The caption follows the fields until someone (or the AI) writes it.
  useEffect(() => {
    if (captionEdited) return;
    setCaption(headline.trim() ? whatsappCaption(piece, { whatsappNumbers: NUMBERS, link }) : '');
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
  };
  const copyText = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); }
    catch { toast({ title: 'Could not copy', description: 'Select it and copy it by hand.', variant: 'destructive' }); }
  };
  const waPhotos = () => { const sel = photos.filter(p => p.toWhatsApp); return hero && sel.some(p => p.id === hero.id) ? [hero, ...sel.filter(p => p.id !== hero.id)] : sel; };
  const shareToChannel = async () => {
    const first = waPhotos()[0];
    if (!first) { toast({ title: 'No photo is ticked for WhatsApp', description: 'Tick WA on a photo first — the channel gets the same square.' }); return; }
    const b = await squareJpeg(first, 1600);
    const f = new File([b], `${fileNameBase}.jpg`, { type: 'image/jpeg' });
    // WhatsApp often drops text shared alongside a file, so the caption goes on the clipboard too.
    try { await navigator.clipboard.writeText(caption); } catch { /* said below either way */ }
    if (!(await shareFiles([f], caption))) download(b, f.name);
    toast({ title: 'Caption is on the clipboard', description: 'Paste it under the photo in the channel.' });
  };

  const connectInstagram = async () => {
    const res = await fetch('/api/instagram/connect', { method: 'POST', headers: await authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.url) { explain('instagram-connect', httpError(d.error || `${res.status}`, res.status)); return; }
    window.location.href = d.url;
  };

  // ── Publishing ──
  const sitePhotos = photos.filter(p => p.toSite);
  const siteOn = toWebsite && uploadsOn && !!folder && sitePhotos.length > 0;
  const waOn = toWhatsApp && !!community && waPhotos().length > 0;
  const igOn = toInstagram && !!ig?.connected;
  const ready = !!hero && !!headline.trim();
  const targets = [siteOn && SITE_NAME, waOn && 'WhatsApp', igOn && 'Instagram'].filter(Boolean) as string[];
  // Checks that are failing for somewhere this post is about to go.
  const blockers: HealthCheck[] = (health.report?.checks ?? []).filter(c => c.status === 'fail' && (
    (siteOn && c.group === 'Website') || (waOn && c.group === 'WhatsApp') || (igOn && c.group === 'Instagram')));
  const problems: string[] = [];
  if (!photos.length) problems.push('Add a photo.');
  if (!headline.trim()) problems.push('Give it a headline.');
  if (toWebsite && !folder) problems.push(`Choose where it goes on ${SITE_NAME}, or switch the website off.`);
  if (toWhatsApp && !caption.trim()) problems.push('The WhatsApp caption is empty.');
  if (lettering === 'ai' && !aiLettered) problems.push('AI lettering is on but not made for this photo — letter it, or switch to our fonts.');

  const setStep = (id: string, patch: Partial<Step>) => setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));

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

  const sendWhatsApp = async (key: string, blob: Blob, name: string, text: string, headers: Record<string, string>) => {
    if (sentRef.current[key]) return;
    const form = new FormData();
    form.set('file', new File([blob], name, { type: 'image/jpeg' }));
    if (text) form.set('caption', text);
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
      ...(waOn ? [{ id: 'whatsapp', label: `WhatsApp · ${community?.name}`, status: 'waiting' as const }] : []),
    ];
    if (!only) setSteps(plan);
    const todo = plan.filter(s => (only ? s.id === only : true) && s.status !== 'done');
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
        } else if (s.id === 'whatsapp') {
          // The caption rides on the first square; the others follow without one.
          const ordered = waPhotos();
          for (let i = 0; i < ordered.length; i++) {
            setStep(s.id, { note: `${i + 1} of ${ordered.length}` });
            // 1600 px: WhatsApp makes no preview for images over 3000 px, and shrinks everything to about this anyway.
            await sendWhatsApp(`photo-${ordered[i].id}`, await squareJpeg(ordered[i], 1600), `${fileNameBase}${i ? `-${i + 1}` : ''}.jpg`, i === 0 ? caption : '', headers);
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

  const onPublish = () => {
    if (problems.length) { toast({ title: 'Not yet', description: problems.join(' '), variant: 'destructive' }); return; }
    if (waOn || igOn || blockers.length) setConfirmOpen(true);
    else runPublish();
  };

  const startOver = () => {
    photos.forEach(p => URL.revokeObjectURL(p.url));
    if (lettered) URL.revokeObjectURL(lettered.url);
    setPhotos([]); setHeroId(null); setKicker(''); setHeadline(''); setWeight(''); setWeightEach(false);
    setStones(''); setHook(''); setCaptionEdited(false); setSiteNameEdited(false); setFeature(false);
    story.reset(emptyDoc(null)); setPalette(PALETTES[0]);
    setLettering('ours'); setLettered(null); setAiCaption(null);
    setSteps([]); uploadedRef.current = {}; sentRef.current = {};
  };

  const published = steps.length > 0 && steps.every(s => s.status === 'done');
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
          <p className="text-sm text-muted-foreground mt-1">Photos and a weight in; the story, the captions and the website photo out — with AI wherever you want it.</p>
        </div>
        {busyList.length > 0 && (
          <div className="flex items-center gap-2 text-sm rounded-full bg-primary/10 text-primary px-3 py-1.5">
            <Loader2 className="h-4 w-4 animate-spin" /> {busyList[busyList.length - 1]}…{busyList.length > 1 ? ` (+${busyList.length - 1})` : ''}
          </div>
        )}
      </div>

      <HealthPanel health={health} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── Left: what goes in ── */}
        <div className="space-y-6 min-w-0">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">1 · Photos</h2>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
              className="rounded-xl border-2 border-dashed border-muted-foreground/25 p-5 text-center"
            >
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4 mr-2" /> Choose photos</Button>
                <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()} className="sm:hidden"><Camera className="h-4 w-4 mr-2" /> Take a photo</Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">Or drag them here. The starred one is the story; <Sparkles className="inline h-3 w-3" /> on a photo for AI.</p>
              <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {(photos.length > 0 || reading > 0) && (
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map(p => (
                  <PhotoTile
                    key={p.id}
                    photo={p}
                    isHero={hero?.id === p.id}
                    locked={publishing}
                    busy={busyAny}
                    siteOn={toWebsite && !!SITE}
                    waOn={toWhatsApp && !!community}
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
            )}
            {photos.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={tidy} onCheckedChange={setTidy} /> AI also removes price tags, strings and old labels</label>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">2 · The piece</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="headline">Headline</Label>
                <Input id="headline" value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Bangle & Ring" className="h-12 text-lg" />
                <div className="flex flex-wrap gap-1.5">
                  {[...(aiCaption?.headlines ?? []), 'Set of the Day', chosen?.collection]
                    .filter((s, i, a): s is string => !!s && s !== headline && a.indexOf(s) === i)
                    .slice(0, 5)
                    .map(s => (
                      <button key={s} type="button" onClick={() => setHeadline(s)} className="text-xs rounded-full border px-2.5 py-1 text-muted-foreground hover:text-foreground">{s}</button>
                    ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weight">Weight (grams)</Label>
                <Input id="weight" inputMode="decimal" value={weight} onChange={e => setWeight(e.target.value.replace(/[^\d.]/g, ''))} onFocus={e => e.currentTarget.select()} placeholder="18.8" className="h-12 text-lg tabular-nums" />
                <label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={weightEach} onCheckedChange={setWeightEach} /> Weight is for each piece</label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kicker">Small line above <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="kicker" value={kicker} onChange={e => setKicker(e.target.value)} placeholder="Lightweight" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="metal">Metal</Label>
                <Input id="metal" value={metal} onChange={e => setMetal(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stones">Stones <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input id="stones" value={stones} onChange={e => setStones(e.target.value)} placeholder="Simulated Sapphires" />
                {aiCaption?.stonesSeen && !stones && <p className="text-xs text-muted-foreground">AI sees: {aiCaption.stonesSeen}. Name them if you know.</p>}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">3 · Where it goes</h2>

            {SITE && (
              <div className="rounded-lg border p-4 space-y-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-medium"><Globe className="h-4 w-4" /> {SITE_NAME}<span className="text-muted-foreground font-normal text-sm">· {sitePhotos.length} photo{sitePhotos.length === 1 ? '' : 's'}</span></span>
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
                  <div className="space-y-1.5">
                    <Label htmlFor="sitename" className="text-xs">Name on the website</Label>
                    <Input id="sitename" value={siteName} onChange={e => { setSiteName(e.target.value); setSiteNameEdited(true); }} placeholder={chosen?.collection ?? 'Piece name'} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <label className="flex items-center gap-2"><Switch checked={weightStamped} disabled={!wLabel}
                      onCheckedChange={v => square.change(d => ({ ...d, layers: d.layers.map(l => l.kind === 'text' && l.bind === 'weight' ? { ...l, hidden: !v } : l) }))} /> {wLabel || 'Weight'} in the corner</label>
                    <button type="button" className="text-xs text-primary" onClick={() => setView('square')}>Edit the square →</button>
                  </div>
                  {STORE_WEBSITE_FEATURED && (
                    <label className="flex items-center gap-2 text-sm"><Switch checked={feature} onCheckedChange={setFeature} /> Make it the set of the day</label>
                  )}
                  <p className="text-xs text-muted-foreground">Tick <Globe className="inline h-3 w-3" /> on each photo that should go up — AI versions included.</p>
                </>)}
              </div>
            )}

            {community && (
              <div className="rounded-lg border p-4 space-y-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-medium"><MessageCircle className="h-4 w-4" /> {community.name}{community.size ? <span className="text-muted-foreground font-normal text-sm">· {community.size.toLocaleString()} members</span> : null}</span>
                  <Switch checked={toWhatsApp} onCheckedChange={setToWhatsApp} />
                </label>
                {!community.reachable && <p className="text-sm text-amber-600">The WhatsApp line did not answer just now. Sending may fail; check Settings → Integrations.</p>}
                {toWhatsApp && (
                  <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2">
                    {waPhotos().length ? `${waPhotos().length} square photo${waPhotos().length === 1 ? '' : 's'}, the caption on the first.` : 'Tick WA on a photo to send it.'}
                    <button type="button" className="text-primary" onClick={() => setView('square')}>Edit the square →</button>
                  </p>
                )}
              </div>
            )}

            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-medium"><Instagram className="h-4 w-4" /> Instagram story{ig?.connected && <span className="text-muted-foreground font-normal text-sm">· @{ig.username}</span>}</span>
                {ig?.connected ? <Switch checked={toInstagram} onCheckedChange={setToInstagram} /> : null}
              </div>
              {!ig?.connected && (
                ig?.configured
                  ? <Button variant="outline" size="sm" onClick={connectInstagram}><Link2 className="h-4 w-4 mr-1.5" /> Connect Instagram</Button>
                  : <p className="text-xs text-muted-foreground">Not connected to this shop&apos;s Instagram yet — share the story from your phone below.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="caption">WhatsApp caption</Label>
                <div className="flex items-center gap-3">
                  {captionEdited && <button type="button" className="text-xs text-muted-foreground" onClick={() => { setCaptionEdited(false); setAiCaption(null); }}>Plain version</button>}
                  <Button type="button" size="sm" variant="secondary" onClick={() => writeWithAi()} disabled={!hero || !!aiBusy.caption}>
                    {aiBusy.caption ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />} Write with AI
                  </Button>
                </div>
              </div>
              <Input value={hook} onChange={e => setHook(e.target.value)} placeholder="One line about it (optional) — goes under the header" />
              <Textarea id="caption" value={caption} onChange={e => { setCaption(e.target.value); setCaptionEdited(true); }} rows={9} className="font-mono text-sm" placeholder="Type a headline and the caption writes itself — or let AI write it from the photo." />
              {aiCaption?.instagramCaption && (
                <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between"><span className="font-medium">Instagram feed caption (AI)</span><button type="button" className="text-primary inline-flex items-center gap-1" onClick={() => copyText(aiCaption.instagramCaption, 'Instagram caption')}><Copy className="h-3 w-3" /> Copy</button></div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{aiCaption.instagramCaption}</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── Right: the story, and what to press ── */}
        <aside className="space-y-4 lg:sticky lg:top-4 self-start">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-full border p-0.5 text-xs">
              <button type="button" onClick={() => setView('story')} className={cn('rounded-full px-3 py-1.5', view === 'story' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>Story <span className="opacity-70">9:16 · Instagram</span></button>
              <button type="button" onClick={() => setView('square')} className={cn('rounded-full px-3 py-1.5', view === 'square' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>Square <span className="opacity-70">1:1 · WhatsApp + site</span></button>
            </div>
            {hero && view === 'story' && (
              <Button size="sm" onClick={() => setWholeOpen(true)} disabled={busyAny}>
                {aiBusy.whole ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1.5" />} Make it with AI
              </Button>
            )}
          </div>
          {view === 'story' && (hero ? (<>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" disabled={busyAny} onClick={() => setRestageFor({ photoId: (hero.ai && photos.find(p => p.id === hero.ai!.parentId)?.id) || hero.id, aspect: '9:16' })}><PaletteIcon className="h-4 w-4 mr-1.5" /> New setting</Button>
              <Button size="sm" variant="outline" disabled={busyAny} onClick={() => aiImage(hero, 'reframe', { aspect: '9:16', tidy }, 'Story frame')}><Expand className="h-4 w-4 mr-1.5" /> Extend to story</Button>
              <Button size="sm" variant="outline" disabled={busyAny} onClick={() => { setAskFor({ photoId: hero.id, aspect: null }); setAskText(''); setAskPromptText(null); }}><MessageSquareText className="h-4 w-4 mr-1.5" /> Ask AI</Button>
            </div>
            <StoryEditor
              api={story}
              fields={fields}
              assets={assets}
              photos={photos.map(p => ({ id: p.id, url: p.url, label: p.ai?.label }))}
              palette={palette}
              onPalette={setPalette}
              lettered={aiLettered?.img ?? null}
              onField={onField}
              weightOwnLine={weightOwnLine}
              websiteLabel={SITE_NAME || 'taheri.shop'}
              presets={PRESETS}
              onPreset={id => story.change(d => applyPreset(d, id as PresetId, palette, fields, assets, { weightOwnLine, wordmark: d.layers.some(l => l.kind === 'wordmark') || d.layers.length === 0 }))}
              overlay={(aiBusy.whole || aiBusy.letter) ? (
                <div className="absolute inset-0 rounded-xl bg-black/45 text-white flex flex-col items-center justify-center gap-2 text-sm text-center p-6">
                  <Loader2 className="h-6 w-6 animate-spin" />{aiBusy.whole ? 'Writing, choosing a setting and photographing it… about a minute' : 'Lettering it and reading it back…'}
                </div>
              ) : null}
            />
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Seg value={lettering} options={[['ours', 'Our fonts'], ['ai', 'AI lettering']]} onChange={v => { setLettering(v as 'ours' | 'ai'); if (v === 'ai' && !aiLettered) letterWithAi(); }} />
                {lettering === 'ai' && (
                  <button type="button" onClick={letterWithAi} disabled={busyAny || !headline.trim()} className="text-xs text-primary inline-flex items-center gap-1"><Type className="h-3 w-3" /> {aiLettered ? 'Letter again' : 'Letter it'}</button>
                )}
              </div>
              {lettering === 'ai' && (
                <Input value={letterStyle} onChange={e => setLetterStyle(e.target.value)} placeholder="Lettering style, in your words (optional) — e.g. gold foil serif, elegant" className="h-8 text-xs" />
              )}
              {aiLettered && (
                <p className={cn('text-xs flex items-center gap-1', aiLettered.verified ? 'text-emerald-600' : 'text-amber-600')}>
                  {aiLettered.verified ? <><ShieldCheck className="h-3.5 w-3.5" /> Read back: every word and the weight are right.</> : <><ShieldAlert className="h-3.5 w-3.5" /> Could not read: {aiLettered.missing.join(', ')}. Check it or use our fonts.</>}
                </p>
              )}
            </div>
          </>) : (
            <div className="mx-auto w-[270px] sm:w-[300px] aspect-[9/16] rounded-xl border-2 border-dashed flex items-center justify-center text-sm text-muted-foreground p-6 text-center">The story appears here once there is a photo.</div>
          ))}

          {view === 'square' && (squarePhotos.length ? (() => {
            const current = squarePhotos.find(p => p.id === square.doc.bg.photoId) ?? squarePhotos[0];
            const notSquare = current && Math.abs(current.img.naturalWidth / current.img.naturalHeight - 1) > 0.02;
            return (<>
              <p className="text-xs text-muted-foreground">What WhatsApp and {SITE_NAME || 'the website'} get: every ticked photo as a square with these words and marks. Same editor as the story — tap, drag, resize, turn.</p>
              <StoryEditor
                api={square}
                square
                fields={fields}
                assets={assets}
                photos={squarePhotos.map(p => ({ id: p.id, url: p.url, label: p.ai?.label }))}
                palette={palette}
                onPalette={setPalette}
                lettered={null}
                onField={onField}
                weightOwnLine={weightOwnLine}
                websiteLabel={SITE_NAME || 'taheri.shop'}
                presets={SQUARE_PRESETS}
                onPreset={id => square.change(d => applySquarePreset(d, id as SquarePresetId, fields, assets))}
                photoTools={current && (
                  <div className="space-y-1.5">
                    {notSquare && <p className="text-[11px] text-amber-600">This photo isn’t square, so its edges are cropped. Drag it to choose what shows, show the whole photo, or let AI widen it to a true square.</p>}
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" disabled={busyAny} onClick={() => aiImage(current, 'reframe', { aspect: '1:1', tidy }, 'Square')}><Expand className="h-4 w-4 mr-1.5" /> AI: make it a true square</Button>
                      <Button size="sm" variant="outline" disabled={busyAny} onClick={() => aiImage(current, 'enhance', { tidy }, 'Enhanced')}><Sparkles className="h-4 w-4 mr-1.5" /> AI: enhance</Button>
                      <Button size="sm" variant="outline" disabled={busyAny} onClick={() => { setAskFor({ photoId: current.id, aspect: '1:1' }); setAskText(''); setAskPromptText(null); }}><MessageSquareText className="h-4 w-4 mr-1.5" /> Ask AI</Button>
                    </div>
                  </div>
                )}
              />
            </>);
          })() : (
            <div className="mx-auto w-[300px] aspect-square rounded-xl border-2 border-dashed flex items-center justify-center text-sm text-muted-foreground p-6 text-center">Tick Site or WA on a photo and its square appears here.</div>
          ))}

          <div className="rounded-lg border p-4 space-y-3">
            {steps.length > 0 && (
              <ul className="space-y-2 text-sm">
                {steps.map(s => (
                  <li key={s.id} className="flex items-start gap-2">
                    <span className="mt-0.5">
                      {s.status === 'done' ? <Check className="h-4 w-4 text-emerald-600" /> : s.status === 'failed' ? <X className="h-4 w-4 text-destructive" /> : s.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="block h-4 w-4 rounded-full border" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{s.label}{s.note ? <span className="text-muted-foreground"> · {s.note}</span> : null}</span>
                      {s.error && (() => {
                        const d = diagnose(STEP_WHERE[s.id] ?? 'page', { status: s.errStatus, message: s.error }, dctx);
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
                  </li>
                ))}
              </ul>
            )}
            {!published ? (
              <Button className="w-full h-12 text-base" onClick={onPublish} disabled={publishing || busyAny || !ready || targets.length === 0 || steps.length > 0}>
                {publishing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Publishing…</> : <><Send className="h-4 w-4 mr-2" /> Publish{targets.length ? ` to ${targets.join(' + ')}` : ''}</>}
              </Button>
            ) : (
              <Button variant="outline" className="w-full" onClick={startOver}>Post another piece</Button>
            )}
            {!ready && <p className="text-xs text-muted-foreground">{problems.slice(0, 2).join(' ')}</p>}

            <div className="border-t pt-3 space-y-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">From your phone</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" disabled={!ready} onClick={shareStory}><Instagram className="h-4 w-4 mr-1.5" /> Share story</Button>
                <Button variant="outline" size="sm" disabled={!ready} onClick={async () => download(await getStory(), `${fileNameBase}-story.jpg`)}><Download className="h-4 w-4 mr-1.5" /> Save story</Button>
                <Button variant="secondary" size="sm" disabled={!ready} onClick={shareToChannel}><Share2 className="h-4 w-4 mr-1.5" /> Channel</Button>
                <Button variant="outline" size="sm" disabled={!caption} onClick={() => copyText(caption, 'Caption')}><Copy className="h-4 w-4 mr-1.5" /> Caption</Button>
              </div>
              {STORE_LINKS.waChannel && (
                <a href={STORE_LINKS.waChannel} target="_blank" rel="noopener" className="text-xs text-primary inline-flex items-center gap-1">Open the WhatsApp channel <ExternalLink className="h-3 w-3" /></a>
              )}
            </div>
          </div>
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
                {waOn && <p>{waPhotos().length} square photo{waPhotos().length === 1 ? '' : 's'} with the caption go{waPhotos().length === 1 ? 'es' : ''} to {community?.name}{community?.size ? ` — ${community.size.toLocaleString()} members` : ''}.</p>}
                {siteOn && <p>{sitePhotos.length} square photo{sitePhotos.length === 1 ? '' : 's'} go{sitePhotos.length === 1 ? 'es' : ''} on {SITE_NAME}.</p>}
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
function PhotoTile({ photo: p, isHero, locked, busy, siteOn, waOn, onHero, onRemove, onToggle, onEnhance, onReframe, onRestage, onAsk }: {
  photo: Photo; isHero: boolean; locked: boolean; busy: boolean; siteOn: boolean; waOn: boolean;
  onHero: () => void; onRemove: () => void; onToggle: (patch: Partial<Photo>) => void;
  onEnhance: () => void; onReframe: (a: Aspect) => void; onRestage: (a: Aspect) => void; onAsk: () => void;
}) {
  const c = p.ai?.check;
  return (
    <li className={cn('rounded-lg overflow-hidden border-2 bg-muted/30', isHero ? 'border-amber-500' : 'border-transparent')}>
      <div className="relative aspect-square">
        <img src={p.url} alt="" className="w-full h-full object-cover" />
        <button type="button" onClick={onHero} aria-label="Use for the story" className={cn('absolute bottom-1.5 left-1.5 h-7 w-7 rounded-full flex items-center justify-center', isHero ? 'bg-amber-500 text-black' : 'bg-black/55 text-white')}>
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
