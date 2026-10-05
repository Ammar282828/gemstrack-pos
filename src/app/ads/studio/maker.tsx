'use client';

/**
 * The studio's maker: a photograph laid out as a Meta ad in the house's own dress, in
 * Post a Piece's editor and full-screen designer (drag, crop, type, marks, filters),
 * framed at Meta's sizes — 4:5 and 1:1 for feeds, 9:16 for stories and reels (with
 * Instagram's own bands shaded, top 14% and bottom 35%), and the 1.91:1 link format.
 *
 *   Words      kicker / headline / call to action on the picture, and the ad's own
 *              primary text and headline — written by the model in the house's voice
 *              and filtered against its rules (/api/ads/studio/copy)
 *   Check      the finished ad in front of a creative director: the house's rules one
 *              by one, the craft, fixes in order, and the sacred dates in the days it
 *              would run (/api/ads/studio/check)
 *   New ad     the picture goes into the ad account's library, the studio remembers
 *              which photographs it used, and Ads → New ad opens with the picture and
 *              the words already in (`?studio=`)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Sparkles, ShieldCheck, Rocket, Download, Upload, ImagePlus, CalendarClock, CheckCircle2, AlertTriangle, XCircle, Layers, Wand2, Eraser, Brush } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_LINKS } from '@/lib/store-config';
import { PALETTES, canvasToJpeg, loadImage } from '@/lib/social/story';
import { reflow, renderDocTo, type Assets, type Bind, type Fields, type StoryDoc } from '@/lib/social/editor';
import { AD_FORMATS, AD_FORMAT_ORDER, AD_TEMPLATES, MORE_FORMAT_ORDER, PHOTO, applyAdTemplate, blankAd, formatInfo, isAdFormat, metaFeedFit, ratioOfFrame, paintedAd, rateBoard, safeZone, type AdFormat, type AdTemplateId, type RateBoard } from '@/lib/ads/studio/templates';
import { GOALS, goesToSite, isChannelLink, type GoalKey } from '@/lib/ads/plan';
import type { Play } from '@/lib/ads/studio/plays';
import { VOICE } from '@/lib/ads/studio/brand';
import type { CheckVerdict, CopyResult, Direction } from '@/lib/ads/studio/prompts';
import { SCENES } from '@/lib/social/prompts';
import { HANDOFF_PREFIX, type StudioHandoff } from '@/lib/ads/studio/handoff';
import { SoloEditor, useStoryDoc } from '../../website/post/story-editor';
import { FONTS, bodyFace, headlineFace, serifFace } from '../../website/post/fonts';
import { useSiteAssets } from '../../website/post/site-assets';
import { api } from '../ads-kit';
import { PostIt } from './post-it';
import { SaveButton, type SavedRestore } from './saved';
import { SITE_LABEL, b64ToBlob, downloadBlob, fetchAsset, runImageOp, safeName, scoreTone, type WorkPhoto } from './studio-kit';

const FORMAT_KEY = 'taheri_studio_format';
const draw = (d: StoryDoc, f: Fields, a: Assets, px: number, q = 0.92) => canvasToJpeg(renderDocTo(reflow(d, f, a), f, a, px), q);

interface CheckAnswer {
  verdict: CheckVerdict;
  words: { text: boolean; headline: boolean };
  invented: string[];
  calendar: { start: string; until: string; quiet: { date: string; level: string; hijri: string; name: string; rule: string }[]; blocked: boolean };
}


const CUSTOM_KEY = 'taheri_studio_custom_ratio';
type Ratio = { w: number; h: number };
/** The shape, and a custom W:H, remembered on this device. */
function useFormat(): [AdFormat, (f: AdFormat) => void, Ratio, (r: Ratio) => void] {
  const [f, setF] = useState<AdFormat>('portrait');
  const [ratio, setRatioState] = useState<Ratio>({ w: 4, h: 5 });
  useEffect(() => {
    try {
      const v = localStorage.getItem(FORMAT_KEY); if (isAdFormat(v)) setF(v);
      const [w, h] = (localStorage.getItem(CUSTOM_KEY) || '').split(':').map(Number); if (w > 0 && h > 0) setRatioState({ w, h });
    } catch { /* private mode */ }
  }, []);
  return [
    f, (v: AdFormat) => { setF(v); try { localStorage.setItem(FORMAT_KEY, v); } catch { /* private mode */ } },
    ratio, (r: Ratio) => { setRatioState(r); try { localStorage.setItem(CUSTOM_KEY, `${r.w}:${r.h}`); } catch { /* private mode */ } },
  ];
}

export function Maker({ work, onChoose, onUpload, play, restore }: { work: WorkPhoto | null; onChoose: () => void; onUpload: (w: WorkPhoto) => void; play?: Play | null; restore?: SavedRestore | null }) {
  const { toast } = useToast();
  const router = useRouter();
  const [format, setFormat, custom, setCustom] = useFormat();
  const [template, setTemplate] = useState<AdTemplateId>('headline');
  const [fields, setFieldsState] = useState<Fields>({ kicker: '', headline: '', weight: '', details: VOICE.ctas[0].replace(/\.$/, '') });
  /** A price the owner types for this ad (prices are allowed since 2026-09-29; the ERP doesn't guess one). */
  const [price, setPrice] = useState('');
  const [photo, setPhoto] = useState<{ key: WorkPhoto; img: HTMLImageElement; url: string; blob: Blob } | null>(null);
  /** A website photo's unmarked original from Drive is used when there is one (originals.ts). */
  const [useOriginal, setUseOriginal] = useState(true);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [painted, setPainted] = useState<{ url: string; blob: Blob; lettering: { ok: boolean; missing: string[]; read: string }; check: { samePiece: boolean; differences: string[] } | null } | null>(null);
  const [checkSoon, setCheckSoon] = useState(false);
  /** Where a tap on the ad goes, and the link for the website and channel. */
  const [goal, setGoal] = useState<GoalKey>('whatsapp');
  const [link, setLink] = useState('');
  /** Send the 9:16 version with a feed ad, as one ad (each place its own size). */
  const [pair, setPair] = useState(true);
  const [rates, setRates] = useState<RateBoard | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** The photo carries the house's mark already (taheri.shop burns it in): the layouts add none. */
  const [marked, setMarked] = useState(false);
  const doc = useStoryDoc(blankAd('portrait'));
  const { marks, ready: assetsReady } = useSiteAssets(!!work);
  const fileRef = useRef<HTMLInputElement>(null);

  // The ad's own words (Meta's fields), and the model's options for them.
  const [text, setText] = useState('');
  const [adHeadline, setAdHeadline] = useState('');
  const [brief, setBrief] = useState('');
  const [copy, setCopy] = useState<CopyResult | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [check, setCheck] = useState<CheckAnswer | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkSig, setCheckSig] = useState('');
  const [start, setStart] = useState(() => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10));
  const [days, setDays] = useState(7);
  const [sending, setSending] = useState(false);
  /** Saved (the Saved tab): which one this is, so Save writes over it. */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedFolder, setSavedFolder] = useState<string | null>(null);
  const reopening = !!restore && restore.work === work;

  const cur = photo && photo.key === work ? photo : null;
  const assets: Assets = useMemo(() => ({ photos: cur ? { [PHOTO]: cur.img } : {} as Assets['photos'], marks, fonts: FONTS }), [cur, marks]);
  const F = formatInfo(format, custom);
  const sig = JSON.stringify([doc.doc, fields, text, adHeadline]);

  // A new photograph: its words start from the assessment, its picture is fetched at full size.
  useEffect(() => {
    setReady(false); setPhotoError(null); setCheck(null); setCopy(null);
    if (!work) return;
    const a = work.asset?.assessment;
    const name = work.asset?.name ?? 'The piece';
    setFieldsState(f => ({ ...f, kicker: work.asset?.source === 'site' && work.asset.collection !== 'Website' ? work.asset.collection : '', headline: a?.headline || name, weight: work.asset?.specs ?? '' }));
    setPrice('');
    setAdHeadline(a?.headline || name);
    setText('');
    setUseOriginal(true); setDirection(null); setPainted(null);
  }, [work]);

  // The photo: an edited copy as it came, else the website photo's clean Drive original, else the photo itself.
  const original = !work?.blob && useOriginal ? work?.asset?.original ?? null : null;
  useEffect(() => {
    if (!work) return;
    let alive = true;
    setReady(false); setPhotoError(null);
    (async () => {
      try {
        let blob = work.blob;
        let clean = !!work.clean;
        if (!blob && original) {
          blob = await fetchAsset(original.id, 2048).catch(() => null);
          if (blob) clean = true; else if (alive) setUseOriginal(false);
        }
        if (!blob && work.asset) blob = await fetchAsset(work.asset.id, 2048);
        if (!blob) throw new Error('No photograph.');
        const url = URL.createObjectURL(blob);
        const img = await loadImage(url);
        if (!alive) { URL.revokeObjectURL(url); return; }
        setMarked(!clean && !!work.asset && (work.asset.source === 'site' || !!work.asset.assessment?.burnedText));
        setPhoto(prev => { if (prev) URL.revokeObjectURL(prev.url); return { key: work, img, url, blob: blob! }; });
      } catch (e) { if (alive) setPhotoError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; };
  }, [work, original?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The extra faces the layouts use, loaded before the first drawing.
  useEffect(() => {
    if (!work) return;
    const extra = FONTS.extra ?? {};
    Promise.all([
      extra.cormorant && document.fonts.load(`italic 500 40px ${extra.cormorant}`),
      extra.cinzel && document.fonts.load(`500 40px ${extra.cinzel}`),
      document.fonts.load(`italic 400 40px ${FONTS.serif}`),
    ]).catch(() => undefined);
  }, [work]);

  // Laid out once the photo, the fonts and the marks are in.
  useEffect(() => {
    if (!cur || !assetsReady || ready) return;
    doc.reset(reopening ? restore!.doc : applyAdTemplate(blankAd(format, F.frame), template, fields, assets, { photoMarked: marked, rates }));
    setReady(true);
  }, [cur, assetsReady, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The same photo crop and layout on another frame (anything added by hand stays with the old frame). */
  const onFrame = (f: AdFormat, t: AdTemplateId, m = marked, r: Ratio = custom) => {
    const blank = blankAd(f, formatInfo(f, r).frame);
    return applyAdTemplate({ ...blank, bg: { ...blank.bg, placement: doc.doc.bg.placement } }, t, fields, assets, { photoMarked: m, rates });
  };
  const layOut = (f: AdFormat, t: AdTemplateId, r: Ratio = custom) => doc.change(() => onFrame(f, t, marked, r));
  const chooseFormat = (f: AdFormat) => { setFormat(f); if (ready) layOut(f, template); setCheck(null); };
  /** A custom W:H, laid out at once when it is the shape in use. */
  const chooseRatio = (r: Ratio) => { setCustom(r); if (ready && format === 'custom') layOut('custom', template, r); setCheck(null); };
  const chooseTemplate = (t: AdTemplateId) => { setTemplate(t); if (ready) doc.change(d => applyAdTemplate(d, t, fields, assets, { photoMarked: marked, rates })); };
  const toggleMarked = (m: boolean) => { setMarked(m); if (ready) doc.change(d => applyAdTemplate(d, template, fields, assets, { photoMarked: m, rates })); };
  const setField = useCallback((b: Bind, v: string) => setFieldsState(f => ({ ...f, [b]: v })), []);

  // Today's rates from the ERP, when the rate board is the layout.
  useEffect(() => {
    if (template !== 'rate' || rates) return;
    api<{ k24: number; k22: number; k21: number; k18: number }>('/api/ads/studio/rates')
      .then(r => setRates(rateBoard(r, new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Karachi' }))))
      .catch(() => setRates({ date: '', rows: [] }));
  }, [template, rates]);
  useEffect(() => { if (template === 'rate' && rates && ready) doc.change(d => applyAdTemplate(d, 'rate', fields, assets, { photoMarked: marked, rates })); }, [rates]); // eslint-disable-line react-hooks/exhaustive-deps

  // A play from the Plan tab: its shape, layout, destination, call to action and brief.
  const playLink = (pl: Play | null | undefined): string => {
    if (pl?.goal === 'channel') return STORE_LINKS.waChannel || '';
    if (pl?.link === 'investments') return STORE_LINKS.website ? `${STORE_LINKS.website.replace(/\/+$/, '')}/investments` : '';
    if (pl?.link === 'shop') { const base = (STORE_LINKS.shop || STORE_LINKS.website || '').replace(/\/+$/, ''); return base ? base + (pl.path ?? '') : ''; }
    return work?.asset?.page ?? STORE_LINKS.website ?? '';
  };
  useEffect(() => {
    if (!play) { setGoal('whatsapp'); setLink(work?.asset?.page ?? STORE_LINKS.website ?? ''); return; }
    setGoal(play.goal); setLink(playLink(play)); setPair(play.pair); setBrief(play.brief);
    setFormat(play.format); setTemplate(play.template);
    setFieldsState(f => ({ ...f, details: play.cta }));
    setReady(false);
  }, [play?.id, work]); // eslint-disable-line react-hooks/exhaustive-deps

  // A saved ad opened again: its words, frame, layout and where it goes, as it was left.
  useEffect(() => {
    if (!restore || restore.work !== work) { setSavedId(null); setSavedFolder(null); return; }
    setSavedId(restore.id); setSavedFolder(restore.folder);
    setFormat(restore.format); setTemplate(restore.template);
    if (restore.format === 'custom' && restore.doc.frame) setCustom(ratioOfFrame(restore.doc.frame));
    setFieldsState(f => ({ ...f, ...restore.fields })); setPrice(restore.price);
    setText(restore.text); setAdHeadline(restore.headline); setGoal(restore.goal); setLink(restore.link);
  }, [work]); // eslint-disable-line react-hooks/exhaustive-deps

  /** An AI result in place of the photo; `clean` when it no longer carries the logo, so the layout adds the house's mark. */
  const replacePhoto = async (blob: Blob, clean: boolean) => {
    if (!work) return;
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    setPhoto(prev => { if (prev) URL.revokeObjectURL(prev.url); return { key: work, img, url, blob }; });
    if (clean) { setMarked(false); doc.change(d => applyAdTemplate(d, template, fields, assets, { photoMarked: false, rates })); }
  };

  const removeLogo = async () => {
    if (!cur || aiBusy) return;
    setAiBusy('Taking the logo and labels off the photo — about a minute…');
    try {
      const r = await runImageOp(cur.blob, 'enhance', { tidy: true });
      await replacePhoto(r.blob, true);
      toast({ title: 'Logo and labels off', description: r.check && !r.check.samePiece ? `The check thinks the piece changed: ${r.check.differences.slice(0, 2).join('; ')}` : 'The house’s mark is back, once, where the layout puts it.' });
    } catch (e) {
      toast({ title: 'Couldn’t take the logo off', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setAiBusy(null); }
  };

  const aiParams = () => ({
    name: work?.asset?.name ?? '', collection: work?.asset?.collection ?? '', specs: fields.weight, price, brief, format, aspect: F.ai, shape: F.label, trimTo: F.short,
    destination: GOALS.find(g => g.key === goal)?.hint ?? 'a WhatsApp chat with the shop', kicker: fields.kicker, headline: fields.headline, cta: fields.details,
  });

  /** Make it with AI: the art director's layout and words, the logo off, the photo extended to the shape if it needs it — then checked. */
  const makeWithAi = async () => {
    if (!cur || !work || aiBusy) return;
    setAiBusy('Designing the ad from the photo and its details — about a minute…');
    setPainted(null);
    try {
      const ratio = (cur.img.naturalWidth / cur.img.naturalHeight) / (F.frame.w / F.frame.h);
      const extend = ratio > 1.3 || ratio < 0.77;
      const photoOp = extend ? runImageOp(cur.blob, 'reframe', { aspect: F.ai, tidy: marked })
        : marked ? runImageOp(cur.blob, 'enhance', { tidy: true }) : null;
      const form = new FormData();
      form.append('op', 'direct');
      form.append('params', JSON.stringify(aiParams()));
      form.append('image', cur.blob, 'photo.jpg');
      const [dir, fixed] = await Promise.all([
        api<{ direction: Direction }>('/api/ads/studio/auto', { form }),
        photoOp ? photoOp.catch(e => { toast({ title: 'The photo couldn’t be prepared', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); return null; }) : Promise.resolve(null),
      ]);
      const d = dir.direction;
      const next: Fields = { ...fields, kicker: d.kicker || fields.kicker, headline: d.headline || fields.headline, details: d.cta || fields.details };
      setFieldsState(next); setTemplate(d.layout); setDirection(d);
      if (d.primaryText[0]) setText(d.primaryText[0]);
      if (d.adHeadlines[0]) setAdHeadline(d.adHeadlines[0]);
      setCopy({ primaryText: d.primaryText, headlines: d.adHeadlines, descriptions: [], onImage: { kicker: d.kicker, headline: d.headline, details: d.cta }, why: d.why });
      // The photo op's "same piece?" check decides: a result that changed the piece (stones redrawn,
      // metal recoloured) never goes into an ad unseen — the original photo stays, and says why.
      const changed = fixed?.check && !fixed.check.samePiece;
      if (changed) toast({ title: 'Kept your photo', description: `The AI changed the piece: ${fixed!.check!.differences.slice(0, 2).join('; ') || 'the check says it is not the same'}. The words and layout are in.`, variant: 'destructive' });
      const use = changed ? null : fixed;
      const nextMarked = use ? false : marked;
      if (use) await replacePhoto(use.blob, false);
      setMarked(nextMarked);
      doc.reset(applyAdTemplate(blankAd(format), d.layout, next, assets, { photoMarked: nextMarked, rates }));
      setCheckSoon(true);
    } catch (e) {
      toast({ title: 'Couldn’t make it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setAiBusy(null); }
  };

  /** The whole ad painted by the image model, read back and compared with the photo before it is offered. */
  const paintWithAi = async () => {
    if (!cur || aiBusy) return;
    if (!fields.headline.trim()) { toast({ title: 'Give it a headline first' }); return; }
    setAiBusy('Painting the whole ad — about a minute and a half…');
    try {
      const form = new FormData();
      form.append('op', 'paint');
      form.append('params', JSON.stringify(aiParams()));
      form.append('image', cur.blob, 'photo.jpg');
      const r = await api<{ image: { data: string; mimeType: string }; lettering: { ok: boolean; missing: string[]; read: string }; check: { samePiece: boolean; differences: string[] } | null }>('/api/ads/studio/auto', { form });
      const blob = b64ToBlob(r.image.data, r.image.mimeType);
      setPainted(prev => { if (prev) URL.revokeObjectURL(prev.url); return { url: URL.createObjectURL(blob), blob, lettering: r.lettering, check: r.check }; });
    } catch (e) {
      toast({ title: 'Couldn’t paint it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setAiBusy(null); }
  };
  const usePainted = async () => {
    if (!painted) return;
    await replacePhoto(painted.blob, false);
    setMarked(false);
    doc.reset(paintedAd(format, assets, F.frame));
    setPainted(null);
    setCheckSoon(true);
  };
  const restage = async (sceneId: string) => {
    if (!cur || aiBusy) return;
    setAiBusy('Setting the piece in a new scene — about a minute…');
    try {
      const r = await runImageOp(cur.blob, 'restage', { sceneId, aspect: F.ai });
      await replacePhoto(r.blob, true);
      if (r.check && !r.check.samePiece) toast({ title: 'Look closely', description: `The check thinks the piece changed: ${r.check.differences.slice(0, 2).join('; ')}` });
    } catch (e) {
      toast({ title: 'Couldn’t restage it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setAiBusy(null); }
  };

  const writeWords = async () => {
    if (!work) return;
    setCopyBusy(true);
    try {
      const a = work.asset?.assessment;
      const r = await api<CopyResult>('/api/ads/studio/copy', { body: {
        name: work.asset?.name ?? '', subject: a?.subject ?? '', category: a?.category ?? '', collection: work.asset?.collection ?? '', brief, goal: 'WhatsApp conversations',
        specs: fields.weight, price,
      } });
      setCopy(r);
      if (r.primaryText[0]) setText(r.primaryText[0]);
      if (r.headlines[0]) setAdHeadline(r.headlines[0]);
      const next = { ...fields, kicker: r.onImage.kicker || fields.kicker, headline: r.onImage.headline || fields.headline, details: r.onImage.details || fields.details };
      setFieldsState(next);
      if (ready) doc.change(d => reflow(d, next, assets));
    } catch (e) {
      toast({ title: 'Couldn’t write the words', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setCopyBusy(false); }
  };

  const runCheck = async () => {
    if (!ready) return;
    setCheckBusy(true);
    try {
      const blob = await draw(doc.doc, fields, assets, 1080, 0.88);
      const form = new FormData();
      form.append('image', blob, 'ad.jpg');
      form.append('format', `${F.label} (${F.where})`);
      form.append('text', text); form.append('headline', adHeadline);
      form.append('specs', fields.weight); form.append('price', price);
      form.append('start', start); form.append('days', String(days));
      setCheck(await api<CheckAnswer>('/api/ads/studio/check', { form }));
      setCheckSig(sig);
    } catch (e) {
      toast({ title: 'Couldn’t check it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setCheckBusy(false); }
  };

  // "Make it with AI" checks what it made, once the new layout is on screen.
  useEffect(() => { if (checkSoon && ready && !checkBusy) { setCheckSoon(false); runCheck(); } }, [checkSoon, ready, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (all: boolean) => {
    if (!ready) return;
    const base = safeName(fields.headline || work?.asset?.name || 'taheri-ad');
    if (!all) { downloadBlob(await draw(doc.doc, fields, assets, F.px), `${base}-${F.short.replace(':', 'x')}.jpg`); return; }
    for (const f of AD_FORMAT_ORDER) {
      const d = f === format ? doc.doc : onFrame(f, template);
      downloadBlob(await draw(d, fields, assets, AD_FORMATS[f].px), `${base}-${AD_FORMATS[f].short.replace(':', 'x')}.jpg`);
    }
    // Meta's four, and the shape on screen when it is another one.
    if (!(AD_FORMAT_ORDER as readonly AdFormat[]).includes(format)) downloadBlob(await draw(doc.doc, fields, assets, F.px), `${base}-${F.short.replace(':', 'x')}.jpg`);
  };

  /** Into a folder of the Saved tab: the picture, the photo it is drawn on and the layout, to open again. */
  const saveAd = async (folder: string | null, asNew: boolean) => {
    if (!cur) return;
    try {
      const image = await draw(doc.doc, fields, assets, F.px);
      const small = await draw(doc.doc, fields, assets, 200, 0.7);
      const thumb = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(small); });
      const scale = Math.min(1, 2048 / Math.max(cur.img.naturalWidth, cur.img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(cur.img.naturalWidth * scale); c.height = Math.round(cur.img.naturalHeight * scale);
      c.getContext('2d')!.drawImage(cur.img, 0, 0, c.width, c.height);
      const photoJpeg = await canvasToJpeg(c, 0.9);
      const form = new FormData();
      form.append('meta', JSON.stringify({
        folder, name: fields.headline || work?.asset?.name || work?.note || 'Ad', format, template, fields, price,
        text, headline: adHeadline, goal, link, asset: work?.asset ? { id: work.asset.id, name: work.asset.name } : null, thumb,
      }));
      form.append('image', image, 'ad.jpg');
      form.append('photo', photoJpeg, 'photo.jpg');
      form.append('doc', new Blob([JSON.stringify(doc.doc)], { type: 'application/json' }), 'doc.json');
      if (savedId && !asNew) form.append('id', savedId);
      const d = await api<{ item: { id: string; folder: string | null } }>('/api/ads/studio/saved', { form });
      setSavedId(d.item.id); setSavedFolder(d.item.folder);
      toast({ title: 'Saved', description: 'In Studio → Saved.' });
    } catch (e) {
      toast({ title: 'Couldn’t save it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const toNewAd = async () => {
    if (!ready) return;
    setSending(true);
    try {
      if ((goal === 'channel' && !isChannelLink(link)) || (goesToSite(goal) && !/^https?:\/\/\S+\.\S+/.test(link.trim()))) {
        throw new Error(goal === 'channel' ? 'Give the WhatsApp channel’s link.' : 'Give the website address the ad opens.');
      }
      const upload = async (b: Blob, name: string) => {
        const form = new FormData();
        form.append('file', b, name);
        return api<{ hash: string; url: string | null }>('/api/ads/images', { form });
      };
      const withStory = pair && (format === 'portrait' || format === 'square');
      const [up, vert] = await Promise.all([
        draw(doc.doc, fields, assets, F.px).then(b => upload(b, `${safeName(fields.headline)}.jpg`)),
        withStory ? draw(onFrame('story', template), fields, assets, AD_FORMATS.story.px).then(b => upload(b, `${safeName(fields.headline)}-9x16.jpg`)) : Promise.resolve(null),
      ]);
      await api('/api/ads/studio/creatives', { body: { assets: work?.asset ? [work.asset.id] : [], hash: up.hash, url: up.url, format, name: fields.headline } }).catch(() => undefined);
      const key = Math.random().toString(36).slice(2, 10);
      const handoff: StudioHandoff = {
        photos: [{ hash: up.hash, url: up.url, headline: adHeadline || fields.headline, link: goesToSite(goal) ? link.trim() : work?.asset?.page ?? STORE_LINKS.website ?? undefined }],
        vertical: vert ? { hash: vert.hash, url: vert.url } : null,
        text, headline: adHeadline || fields.headline, goal, link: goesToSite(goal) || goal === 'channel' ? link.trim() : undefined,
        name: `${fields.headline || 'Studio ad'} · ${F.short}${vert ? ' + 9:16' : ''}`,
      };
      sessionStorage.setItem(HANDOFF_PREFIX + key, JSON.stringify(handoff));
      router.push(`/ads/new?studio=${key}`);
    } catch (e) {
      toast({ title: 'Couldn’t send it to a new ad', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      setSending(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    onUpload({ asset: null, blob: file, note: file.name });
  };

  if (!work) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
        <Layers className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="font-medium">Choose a photograph to make an ad from</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">Open any photo in Photos and press “Make an ad”, fixed or as it is — or start from a photo on this device.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onChoose}><ImagePlus className="h-4 w-4 mr-1.5" /> Choose from the picks</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1.5" /> A photo from this device</Button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
      </div>
    );
  }

  const zone = safeZone(F.frame);
  const stale = !!check && checkSig !== sig;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] gap-5 items-start">
      {/* The canvas's faces, present in the page. */}
      <span aria-hidden className={cn(headlineFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(bodyFace.className, 'sr-only')}>.</span>
      <span aria-hidden className={cn(serifFace.className, 'sr-only')}>.</span>

      <div className="space-y-3 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Ad size">
          {AD_FORMAT_ORDER.map(f => (
            <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => chooseFormat(f)} title={AD_FORMATS[f].where}
              className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', format === f ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>
              {AD_FORMATS[f].label}
            </button>
          ))}
          {/* Any other shape: every ratio the image model draws, or your own W:H. */}
          <Select value={F.meta ? '' : format} onValueChange={v => chooseFormat(v as AdFormat)}>
            <SelectTrigger aria-label="Any shape" title="Any other shape — the AI draws the ad at this ratio"
              className={cn('h-auto w-auto gap-1 rounded-full px-3 py-1.5 text-xs min-h-0', !F.meta && 'bg-primary text-primary-foreground border-primary')}>
              <SelectValue placeholder="Any shape" />
            </SelectTrigger>
            <SelectContent>
              {MORE_FORMAT_ORDER.map(f => <SelectItem key={f} value={f}>{AD_FORMATS[f].label}</SelectItem>)}
              <SelectItem value="custom">Custom W:H…</SelectItem>
            </SelectContent>
          </Select>
          {format === 'custom' && (
            <span className="inline-flex items-center gap-1 text-xs" title={F.where}>
              <RatioInput label="Width" value={custom.w} onValue={w => chooseRatio({ ...custom, w })} />
              :
              <RatioInput label="Height" value={custom.h} onValue={h => chooseRatio({ ...custom, h })} />
              <span className="text-muted-foreground">AI at {F.ai}</span>
            </span>
          )}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {AD_TEMPLATES.map(t => (
            <button key={t.id} type="button" disabled={!ready} onClick={() => chooseTemplate(t.id)} title={t.note}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap min-h-0', template === t.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{t.label}</button>
          ))}
        </div>
        {original && cur && (
          <p className="text-[11px] rounded-lg bg-emerald-500/10 p-2">
            <span title={original.name}>Drive original, no logo.</span>{' '}
            <button type="button" className="text-primary min-h-0" onClick={() => setUseOriginal(false)}>Use the website’s</button>
          </p>
        )}
        {!original && !work.blob && work.asset?.original && (
          <p className="text-[11px] text-muted-foreground"><span title={work.asset.original.name}>A clean original is in Drive.</span> <button type="button" className="text-primary min-h-0" onClick={() => setUseOriginal(true)}>Use it</button></p>
        )}
        {marked && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 flex flex-wrap items-center gap-2">
            <p className="text-[11px] flex-1 min-w-[8rem]">Logo{work.asset?.assessment?.burnedText ? ' and label' : ''} on the photo</p>
            <Button size="sm" disabled={!cur || !!aiBusy} onClick={removeLogo}><Eraser className="h-4 w-4 mr-1" /> Remove the logo</Button>
          </div>
        )}
        {!marked && work.asset?.source === 'site' && !original && (
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={marked} onChange={e => toggleMarked(e.target.checked)} /> Logo already on the photo
          </label>
        )}
        {aiBusy && <p className="text-xs rounded-lg bg-primary/10 p-2 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin shrink-0" /> {aiBusy}</p>}
        {photoError ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{photoError}</p>
        ) : (
          <SoloEditor side={{
            label: 'The ad', sub: `${F.label} · ${F.px}×${Math.round(F.px * F.frame.h / F.frame.w)}`,
            placeholder: ready ? undefined : (
              <div className="mx-auto flex aspect-[4/5] w-[300px] max-w-full items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fetching the photo…
              </div>
            ),
            bottom: null,
            props: {
              api: doc, square: true, fields, assets,
              photos: cur ? [{ id: PHOTO, url: cur.url, label: work.note || work.asset?.name || 'The photo' }] : [],
              palette: PALETTES[0], onPalette: () => undefined, lettered: null, weightOwnLine: true, websiteLabel: SITE_LABEL,
              onField: setField,
              presets: AD_TEMPLATES.map(t => ({ id: t.id, label: t.label })), onPreset: id => chooseTemplate(id as AdTemplateId),
              previewPreset: id => applyAdTemplate(doc.doc, id as AdTemplateId, fields, assets, { photoMarked: marked, rates }),
              fileName: safeName(fields.headline),
              cropLabel: 'The photo', photoNote: 'Drag or pinch it to choose what shows; the piece should fill the frame on a phone.',
              overlay: zone.top ? (
                <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 bg-sky-500/15 border-b border-dashed border-sky-500/60" style={{ height: `${(zone.top / F.frame.h) * 100}%` }} />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-sky-500/15 border-t border-dashed border-sky-500/60" style={{ height: `${(zone.bottom / F.frame.h) * 100}%` }} />
                </>
              ) : undefined,
            },
          }} />
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!ready} onClick={() => download(false)}><Download className="h-4 w-4 mr-1" /> Download {F.short}</Button>
          <Button variant="outline" size="sm" disabled={!ready} onClick={() => download(true)}><Download className="h-4 w-4 mr-1" /> Every size</Button>
          <SaveButton ready={ready} savedId={savedId} folder={savedFolder} onSave={saveAd} />
          <Button variant="ghost" size="sm" onClick={onChoose}><ImagePlus className="h-4 w-4 mr-1" /> Another photo</Button>
        </div>
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-2.5">
          <p className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> Make it with AI</p>
          <Input value={brief} onChange={e => setBrief(e.target.value)} placeholder="Aim (optional) — e.g. Eid gifting" className="h-9 text-base sm:text-sm" />
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" disabled={!cur || !!aiBusy} onClick={makeWithAi}>{aiBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />} Make it with AI</Button>
            <Button variant="outline" disabled={!cur || !!aiBusy} onClick={paintWithAi} title="The image model draws the whole ad, lettering included — then it is read back and compared with the photo"><Brush className="h-4 w-4 mr-1.5" /> Paint the whole ad</Button>
          </div>
          {direction && (
            <div className="text-[11px] space-y-1">
              <p className="text-muted-foreground italic">{direction.why}</p>
              {direction.scene && <p>A new setting would suit it: <button type="button" className="text-primary min-h-0" disabled={!!aiBusy} onClick={() => restage(direction.scene!)}>{SCENES.find(x => x.id === direction.scene)?.label ?? direction.scene} — try it</button></p>}
            </div>
          )}
          {painted && (
            <div className="rounded-lg border bg-background p-2 space-y-2">
              <img src={painted.url} alt="The painted ad" className="w-full rounded-md" />
              <p className={cn('text-[11px]', painted.lettering.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300')}>
                {painted.lettering.ok ? 'Every line reads back exactly.' : `Lettering to check: ${painted.lettering.missing.map(m => `“${m}”`).join(', ') || 'it could not be read back'}.`}
              </p>
              {painted.check && <p className={cn('text-[11px]', painted.check.samePiece ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-300')}>{painted.check.samePiece ? 'The same piece as the photo.' : `The piece may have changed: ${painted.check.differences.slice(0, 3).join('; ')}`}</p>}
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" variant={painted.check && !painted.check.samePiece ? 'outline' : 'default'} onClick={usePainted}>{painted.check && !painted.check.samePiece ? 'Use it anyway' : 'Use this ad'}</Button>
                <Button size="sm" variant="outline" disabled={!!aiBusy} onClick={paintWithAi}>Paint again</Button>
                <Button size="sm" variant="ghost" onClick={() => setPainted(null)}>Discard</Button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border p-3 space-y-2.5">
          <p className="text-sm font-semibold">On the picture</p>
          <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">Kicker</span>
            <Input value={fields.kicker} onChange={e => setField('kicker', e.target.value)} placeholder="The Emerald Edit" className="h-9 text-base sm:text-sm" /></label>
          <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">Headline</span>
            <Input value={fields.headline} onChange={e => setField('headline', e.target.value)} className="h-9 text-base sm:text-sm" /></label>
          <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">Specs</span>
            <Input value={fields.weight} onChange={e => setField('weight', e.target.value)} placeholder="21K Yellow Gold · Ruby · 45.35g" className="h-9 text-base sm:text-sm" /></label>
          {work.asset?.specs && fields.weight !== work.asset.specs && <button type="button" onClick={() => setField('weight', work.asset!.specs)} className="text-[10px] text-primary min-h-0">Back to the ERP’s: {work.asset.specs}</button>}
          <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">Price</span>
            <Input value={price} onChange={e => setPrice(e.target.value)} placeholder="Optional" className="h-9 text-base sm:text-sm" /></label>
          {price.trim() && <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => setField('details', price.trim())} className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground min-h-0">Put the price on the picture</button>
            <span className="text-[10px] text-amber-700 dark:text-amber-400">A rupee price goes stale as the gold rate moves while the ad runs.</span>
          </div>}
          <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">Button line</span>
            <Input value={fields.details} onChange={e => setField('details', e.target.value)} className="h-9 text-base sm:text-sm" /></label>
          <div className="flex flex-wrap gap-1">
            {VOICE.ctas.map(c => <button key={c} type="button" onClick={() => setField('details', c.replace(/\.$/, ''))} className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground min-h-0">{c.replace(/\.$/, '')}</button>)}
          </div>
        </section>

        <section className="rounded-xl border p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">The ad’s words</p>
            <Button size="sm" variant="outline" disabled={copyBusy} onClick={writeWords}>{copyBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />} Write with AI</Button>
          </div>
          <Textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Primary text" className="text-base sm:text-sm" />
          {copy && copy.primaryText.length > 1 && (
            <div className="space-y-1">
              {copy.primaryText.map((t, i) => <button key={i} type="button" onClick={() => setText(t)} className={cn('block w-full text-left rounded-lg border p-2 text-[11px] min-h-0', text === t ? 'border-primary bg-primary/5' : 'text-muted-foreground')}>{t}</button>)}
            </div>
          )}
          <Input value={adHeadline} onChange={e => setAdHeadline(e.target.value)} placeholder="Headline" maxLength={60} className="h-9 text-base sm:text-sm" />
          {copy && copy.headlines.length > 1 && (
            <div className="flex flex-wrap gap-1">{copy.headlines.map((h, i) => <button key={i} type="button" onClick={() => setAdHeadline(h)} className={cn('rounded-full border px-2 py-0.5 text-[11px] min-h-0', adHeadline === h ? 'border-primary' : 'text-muted-foreground')}>{h}</button>)}</div>
          )}
          {copy?.why && <p className="text-[11px] text-muted-foreground italic">{copy.why}</p>}
        </section>

        <section className="rounded-xl border p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> Before it spends</p>
            <Button size="sm" disabled={!ready || checkBusy} onClick={runCheck}>{checkBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />} {check ? 'Check again' : 'Check this ad'}</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Runs from</span>
            <Input type="date" value={start} onChange={e => setStart(e.target.value)} className="h-8 w-auto text-base sm:text-xs" />
            <span className="text-muted-foreground">for</span>
            <Input type="number" min={1} max={90} value={days} onChange={e => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 7)))} className="h-8 w-16 text-base sm:text-xs" />
            <span className="text-muted-foreground">days</span>
          </div>
          {checkBusy && <p className="text-[11px] text-muted-foreground">Checking… (~30 s)</p>}
          {check && <CheckCard c={check} stale={stale} />}
        </section>

        <section className="rounded-xl border p-3 space-y-2">
          <p className="text-sm font-semibold">Where a tap goes</p>
          <div className="grid grid-cols-2 gap-1.5">
            {GOALS.filter(g => !g.postOnly && (g.key !== 'channel' || !!STORE_LINKS.waChannel) && (g.key !== 'sales' || !!(STORE_LINKS.shop || STORE_LINKS.website))).map(g => (
              <button key={g.key} type="button" onClick={() => { setGoal(g.key); if (g.key === 'channel') setLink(STORE_LINKS.waChannel || ''); else if (g.key === 'sales') setLink(STORE_LINKS.shop || work?.asset?.page || STORE_LINKS.website || ''); else if (g.key === 'website' && !/^https?:/.test(link)) setLink(work?.asset?.page ?? STORE_LINKS.website ?? ''); }}
                className={cn('rounded-lg border px-2 py-1.5 text-left text-[11px] min-h-0', goal === g.key ? 'border-primary bg-primary/5 font-medium' : 'text-muted-foreground')}>{g.label}</button>
            ))}
          </div>
          {(goesToSite(goal) || goal === 'channel') && <Input value={link} onChange={e => setLink(e.target.value)} placeholder={goal === 'channel' ? 'https://whatsapp.com/channel/…' : 'https://…'} className="h-9 text-base sm:text-xs" />}
          {!F.meta && (
            <p className="text-[11px] text-muted-foreground">
              {metaFeedFit(F.frame) === 'as-is'
                ? `Meta shows this ${F.short} picture as it is in feeds (anything from 1.91:1 to 4:5); stories want 9:16.`
                : `Meta crops this ${F.short} picture to ${metaFeedFit(F.frame)} in feeds — keep the piece and the words in the middle.`}
            </p>
          )}
          {(format === 'portrait' || format === 'square') && (
            <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" className="mt-0.5" checked={pair} onChange={e => setPair(e.target.checked)} />
              <span title={`One ad: the ${F.short} picture in feeds, the 9:16 one in stories, reels and WhatsApp Status.`}>With a 9:16 for stories</span>
            </label>
          )}
        </section>

        <PostIt ready={ready} name={fields.headline || work?.asset?.name || ''}
          caption={[text.trim(), work?.asset?.page ?? ''].filter(Boolean).join('\n\n')}
          render={f => draw(f === format ? doc.doc : onFrame(f, template), fields, assets, AD_FORMATS[f].px)} />

        <Button className="w-full h-11" disabled={!ready || sending} onClick={toNewAd}>
          {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Rocket className="h-4 w-4 mr-1.5" />} Use it in a new ad
        </Button>
      </div>
    </div>
  );
}

/** One side of a custom W:H: typed freely (it may be empty for a moment), used once it is a whole number 1–100. */
function RatioInput({ label, value, onValue }: { label: string; value: number; onValue: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(t => (Number(t) === value ? t : String(value))); }, [value]);
  return (
    // Text, not a number box: a box this narrow is mostly spinner, and a click in it nudged the number.
    <Input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={text} aria-label={label} className="h-8 w-12 text-center text-base sm:text-xs"
      onChange={e => { const t = e.target.value.replace(/\D/g, ''); setText(t); const n = Number(t); if (n >= 1 && n <= 100) onValue(n); }}
      onBlur={() => setText(String(value))} />
  );
}

function CheckCard({ c, stale }: { c: CheckAnswer; stale: boolean }) {
  const v = c.verdict;
  const tone = v.verdict === 'run' ? 'border-emerald-500/50 bg-emerald-500/5' : v.verdict === 'fix' ? 'border-amber-500/50 bg-amber-500/5' : 'border-rose-500/50 bg-rose-500/5';
  const Icon = v.verdict === 'run' ? CheckCircle2 : v.verdict === 'fix' ? AlertTriangle : XCircle;
  const broken = v.rules.filter(r => !r.ok);
  const craft = v.craft.filter(r => !r.ok);
  return (
    <div className={cn('rounded-xl border p-3 space-y-2', tone, stale && 'opacity-60')}>
      {stale && <p className="text-[11px] font-medium">The ad changed since this check — check again.</p>}
      <div className="flex items-start gap-2">
        <Icon className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{v.verdict === 'run' ? 'Ready to run' : v.verdict === 'fix' ? 'Worth running after a few changes' : 'Don’t run this'} <span className={cn('ml-1 rounded-full px-2 py-0.5 text-[11px] tabular-nums', scoreTone(v.score))}>{v.score}</span></p>
          <p className="text-xs text-muted-foreground">{v.summary}</p>
        </div>
      </div>
      {c.calendar.blocked && (
        <div className="rounded-lg bg-rose-500/10 p-2 text-xs space-y-0.5">
          <p className="font-semibold">It would run through sacred days — end it before them or start after:</p>
          {c.calendar.quiet.filter(q => q.level !== 'quiet').map(q => <p key={q.date}>{q.date} · {q.hijri} — {q.name}{q.level === 'near' ? ' (the days before)' : ''}</p>)}
        </div>
      )}
      {(c.words.text || c.words.headline) && <p className="text-xs text-rose-700 dark:text-rose-300">The {c.words.text ? 'primary text' : 'headline'} has sale or discount words, or a hashtag.</p>}
      {c.invented.length > 0 && <p className="text-xs text-rose-700 dark:text-rose-300">Figures the ERP didn’t give: {c.invented.join(', ')} — check them, or take them out.</p>}
      {broken.length > 0 && <div className="text-xs"><p className="font-semibold">House rules</p><ul className="list-disc pl-4">{broken.map((r, i) => <li key={i}>{r.rule} — {r.note}</li>)}</ul></div>}
      {craft.length > 0 && <div className="text-xs"><p className="font-semibold">Craft</p><ul className="list-disc pl-4">{craft.map((r, i) => <li key={i}><b>{r.aspect}:</b> {r.note}</li>)}</ul></div>}
      {v.fixes.length > 0 && <div className="text-xs"><p className="font-semibold">Do, in this order</p><ol className="list-decimal pl-4">{v.fixes.map((f, i) => <li key={i}>{f}</li>)}</ol></div>}
      {v.strengths.length > 0 && <p className="text-[11px] text-muted-foreground"><b>Keep:</b> {v.strengths.join(' · ')}</p>}
    </div>
  );
}

