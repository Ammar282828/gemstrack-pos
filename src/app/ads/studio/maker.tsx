'use client';

/**
 * The studio's maker: a photograph laid out as a Meta ad in Taheri's own dress, in
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Sparkles, ShieldCheck, Rocket, Download, Upload, ImagePlus, CalendarClock, CheckCircle2, AlertTriangle, XCircle, Layers, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_LINKS } from '@/lib/store-config';
import { PALETTES, canvasToJpeg, loadImage } from '@/lib/social/story';
import { reflow, renderDocTo, type Assets, type Bind, type Fields, type StoryDoc } from '@/lib/social/editor';
import { AD_FORMATS, AD_FORMAT_ORDER, AD_TEMPLATES, PHOTO, applyAdTemplate, blankAd, safeZone, type AdFormat, type AdTemplateId } from '@/lib/ads/studio/templates';
import { VOICE } from '@/lib/ads/studio/brand';
import type { CheckVerdict, CopyResult } from '@/lib/ads/studio/prompts';
import { HANDOFF_PREFIX, type StudioHandoff } from '@/lib/ads/studio/handoff';
import { SoloEditor, useStoryDoc } from '../../website/post/story-editor';
import { FONTS, bodyFace, headlineFace, serifFace } from '../../website/post/fonts';
import { useSiteAssets } from '../../website/post/site-assets';
import { api } from '../ads-kit';
import { downloadBlob, fetchAsset, safeName, scoreTone, type WorkPhoto } from './studio-kit';

const FORMAT_KEY = 'taheri_studio_format';
const draw = (d: StoryDoc, f: Fields, a: Assets, px: number, q = 0.92) => canvasToJpeg(renderDocTo(reflow(d, f, a), f, a, px), q);

interface CheckAnswer {
  verdict: CheckVerdict;
  words: { text: boolean; headline: boolean };
  calendar: { start: string; until: string; quiet: { date: string; level: string; hijri: string; name: string; rule: string }[]; blocked: boolean };
}


function useFormat(): [AdFormat, (f: AdFormat) => void] {
  const [f, setF] = useState<AdFormat>('portrait');
  useEffect(() => { try { const v = localStorage.getItem(FORMAT_KEY) as AdFormat | null; if (v && v in AD_FORMATS) setF(v); } catch { /* private mode */ } }, []);
  return [f, (v: AdFormat) => { setF(v); try { localStorage.setItem(FORMAT_KEY, v); } catch { /* private mode */ } }];
}

export function Maker({ work, onChoose, onUpload }: { work: WorkPhoto | null; onChoose: () => void; onUpload: (w: WorkPhoto) => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [format, setFormat] = useFormat();
  const [template, setTemplate] = useState<AdTemplateId>('headline');
  const [fields, setFieldsState] = useState<Fields>({ kicker: '', headline: '', weight: '', details: 'Inquiries welcome' });
  const [photo, setPhoto] = useState<{ key: WorkPhoto; img: HTMLImageElement; url: string } | null>(null);
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

  const cur = photo && photo.key === work ? photo : null;
  const assets: Assets = useMemo(() => ({ photos: cur ? { [PHOTO]: cur.img } : {} as Assets['photos'], marks, fonts: FONTS }), [cur, marks]);
  const F = AD_FORMATS[format];
  const sig = JSON.stringify([doc.doc, fields, text, adHeadline]);

  // A new photograph: its words start from the assessment, its picture is fetched at full size.
  useEffect(() => {
    setReady(false); setPhotoError(null); setCheck(null); setCopy(null);
    if (!work) return;
    const a = work.asset?.assessment;
    const name = work.asset?.name ?? 'The piece';
    setFieldsState(f => ({ ...f, kicker: work.asset?.source === 'site' && work.asset.collection !== 'Website' ? work.asset.collection : '', headline: a?.headline || name }));
    setAdHeadline(a?.headline || name);
    setText('');
    setMarked(!!work.asset && (work.asset.source === 'site' || !!a?.burnedText) && !work.clean);
    let alive = true;
    (async () => {
      try {
        const blob = work.blob ?? (work.asset ? await fetchAsset(work.asset.id, 2048) : null);
        if (!blob) throw new Error('No photograph.');
        const url = URL.createObjectURL(blob);
        const img = await loadImage(url);
        if (!alive) { URL.revokeObjectURL(url); return; }
        setPhoto(prev => { if (prev) URL.revokeObjectURL(prev.url); return { key: work, img, url }; });
      } catch (e) { if (alive) setPhotoError(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { alive = false; };
  }, [work]);

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
    doc.reset(applyAdTemplate(blankAd(format), template, fields, assets, { photoMarked: marked }));
    setReady(true);
  }, [cur, assetsReady, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The same photo crop and layout on another frame (anything added by hand stays with the old frame). */
  const onFrame = (f: AdFormat, t: AdTemplateId, m = marked) => applyAdTemplate({ ...blankAd(f), bg: { ...blankAd(f).bg, placement: doc.doc.bg.placement } }, t, fields, assets, { photoMarked: m });
  const layOut = (f: AdFormat, t: AdTemplateId) => doc.change(() => onFrame(f, t));
  const chooseFormat = (f: AdFormat) => { setFormat(f); if (ready) layOut(f, template); setCheck(null); };
  const chooseTemplate = (t: AdTemplateId) => { setTemplate(t); if (ready) doc.change(d => applyAdTemplate(d, t, fields, assets, { photoMarked: marked })); };
  const toggleMarked = (m: boolean) => { setMarked(m); if (ready) doc.change(d => applyAdTemplate(d, template, fields, assets, { photoMarked: m })); };
  const setField = useCallback((b: Bind, v: string) => setFieldsState(f => ({ ...f, [b]: v })), []);

  const writeWords = async () => {
    if (!work) return;
    setCopyBusy(true);
    try {
      const a = work.asset?.assessment;
      const r = await api<CopyResult>('/api/ads/studio/copy', { body: {
        name: work.asset?.name ?? '', subject: a?.subject ?? '', category: a?.category ?? '', collection: work.asset?.collection ?? '', brief, goal: 'WhatsApp conversations',
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
      form.append('start', start); form.append('days', String(days));
      setCheck(await api<CheckAnswer>('/api/ads/studio/check', { form }));
      setCheckSig(sig);
    } catch (e) {
      toast({ title: 'Couldn’t check it', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setCheckBusy(false); }
  };

  const download = async (all: boolean) => {
    if (!ready) return;
    const base = safeName(fields.headline || work?.asset?.name || 'taheri-ad');
    if (!all) { downloadBlob(await draw(doc.doc, fields, assets, F.px), `${base}-${F.short.replace(':', 'x')}.jpg`); return; }
    for (const f of AD_FORMAT_ORDER) {
      const d = f === format ? doc.doc : onFrame(f, template);
      downloadBlob(await draw(d, fields, assets, AD_FORMATS[f].px), `${base}-${AD_FORMATS[f].short.replace(':', 'x')}.jpg`);
    }
  };

  const toNewAd = async () => {
    if (!ready) return;
    setSending(true);
    try {
      const blob = await draw(doc.doc, fields, assets, F.px);
      const form = new FormData();
      form.append('file', blob, `${safeName(fields.headline)}.jpg`);
      const up = await api<{ hash: string; url: string | null }>('/api/ads/images', { form });
      await api('/api/ads/studio/creatives', { body: { assets: work?.asset ? [work.asset.id] : [], hash: up.hash, url: up.url, format, name: fields.headline } }).catch(() => undefined);
      const key = Math.random().toString(36).slice(2, 10);
      const handoff: StudioHandoff = {
        photos: [{ hash: up.hash, url: up.url, headline: adHeadline || fields.headline, link: work?.asset?.page ?? STORE_LINKS.website ?? undefined }],
        text, headline: adHeadline || fields.headline, goal: 'whatsapp', name: `${fields.headline || 'Studio ad'} · ${F.short}`,
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
        <p className="text-sm text-muted-foreground max-w-md mx-auto">Open any photo in Picks or the Library and press “Make an ad”, fixed or as it is — or start from a photo on this device.</p>
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
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ad size">
          {AD_FORMAT_ORDER.map(f => (
            <button key={f} type="button" role="radio" aria-checked={format === f} onClick={() => chooseFormat(f)} title={AD_FORMATS[f].where}
              className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', format === f ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>
              {AD_FORMATS[f].label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground -mt-1">{F.where}. {format === 'story' ? 'The shaded bands are where Instagram draws its own buttons — keep words and the piece out of them.' : format === 'portrait' ? 'Meta shows 4:5 largest in feeds; pair it with a 9:16 for stories.' : ''}</p>
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {AD_TEMPLATES.map(t => (
            <button key={t.id} type="button" disabled={!ready} onClick={() => chooseTemplate(t.id)} title={t.note}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap min-h-0', template === t.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{t.label}</button>
          ))}
        </div>
        <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <input type="checkbox" className="mt-0.5" checked={marked} onChange={e => toggleMarked(e.target.checked)} />
          <span>The photo already carries the taheri mark{work.asset?.assessment?.burnedText ? ' (and a label)' : ''} — the layout adds none, as one mark per picture is the rule.{marked && work.asset ? ' “Clear old labels” in the photo’s sheet takes them off for a clean ad.' : ''}</span>
        </label>
        {photoError ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">{photoError}</p>
        ) : (
          <SoloEditor side={{
            label: 'The ad', sub: `${F.label} · ${F.frame.w === 1080 && F.px === 1080 ? `${F.frame.w}×${F.frame.h}` : '1200×628'}`,
            placeholder: ready ? undefined : (
              <div className="mx-auto flex aspect-[4/5] w-[300px] max-w-full items-center justify-center rounded-xl border-2 border-dashed text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fetching the photo…
              </div>
            ),
            bottom: <p className="text-[11px] text-muted-foreground">Drag or pinch the photo to crop; tap words to change them; “Design” opens the full designer (elements, frames, filters, layers).</p>,
            props: {
              api: doc, square: true, fields, assets,
              photos: cur ? [{ id: PHOTO, url: cur.url, label: work.note || work.asset?.name || 'The photo' }] : [],
              palette: PALETTES[0], onPalette: () => undefined, lettered: null, weightOwnLine: true, websiteLabel: 'taheri.shop',
              onField: setField,
              presets: AD_TEMPLATES.map(t => ({ id: t.id, label: t.label })), onPreset: id => chooseTemplate(id as AdTemplateId),
              previewPreset: id => applyAdTemplate(doc.doc, id as AdTemplateId, fields, assets, { photoMarked: marked }),
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
          <Button variant="ghost" size="sm" onClick={onChoose}><ImagePlus className="h-4 w-4 mr-1" /> Another photo</Button>
        </div>
      </div>

      <div className="space-y-4">
        <section className="rounded-xl border p-3 space-y-2.5">
          <p className="text-sm font-semibold">On the picture</p>
          <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">Small line above (gold capitals)</span>
            <Input value={fields.kicker} onChange={e => setField('kicker', e.target.value)} placeholder="e.g. The Emerald Edit" className="h-9 text-base sm:text-sm" /></label>
          <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">Headline (six words at most)</span>
            <Input value={fields.headline} onChange={e => setField('headline', e.target.value)} className="h-9 text-base sm:text-sm" /></label>
          <label className="block space-y-1"><span className="text-[11px] text-muted-foreground">Invitation</span>
            <Input value={fields.details} onChange={e => setField('details', e.target.value)} className="h-9 text-base sm:text-sm" /></label>
          <div className="flex flex-wrap gap-1">
            {VOICE.softCtas.map(c => <button key={c} type="button" onClick={() => setField('details', c.replace(/\.$/, ''))} className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground min-h-0">{c.replace(/\.$/, '')}</button>)}
          </div>
        </section>

        <section className="rounded-xl border p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">The ad’s words</p>
            <Button size="sm" variant="outline" disabled={copyBusy} onClick={writeWords}>{copyBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />} Write with AI</Button>
          </div>
          <Input value={brief} onChange={e => setBrief(e.target.value)} placeholder="Anything to say? (optional — e.g. for Eid gifting)" className="h-8 text-base sm:text-xs" />
          <Textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Primary text — two sentences: the work, and how it is worn." className="text-base sm:text-sm" />
          {copy && copy.primaryText.length > 1 && (
            <div className="space-y-1">
              {copy.primaryText.map((t, i) => <button key={i} type="button" onClick={() => setText(t)} className={cn('block w-full text-left rounded-lg border p-2 text-[11px] min-h-0', text === t ? 'border-primary bg-primary/5' : 'text-muted-foreground')}>{t}</button>)}
            </div>
          )}
          <Input value={adHeadline} onChange={e => setAdHeadline(e.target.value)} placeholder="Headline under the ad (40 characters)" maxLength={60} className="h-9 text-base sm:text-sm" />
          {copy && copy.headlines.length > 1 && (
            <div className="flex flex-wrap gap-1">{copy.headlines.map((h, i) => <button key={i} type="button" onClick={() => setAdHeadline(h)} className={cn('rounded-full border px-2 py-0.5 text-[11px] min-h-0', adHeadline === h ? 'border-primary' : 'text-muted-foreground')}>{h}</button>)}</div>
          )}
          {copy?.why && <p className="text-[11px] text-muted-foreground italic">{copy.why}</p>}
          <p className="text-[10px] text-muted-foreground">No price, karat, weight, “shop now”, hashtag or number ever gets through — the house’s rules are checked after the model.</p>
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
          {checkBusy && <p className="text-[11px] text-muted-foreground">A creative director is looking at it against the house’s rules — about half a minute.</p>}
          {check && <CheckCard c={check} stale={stale} />}
        </section>

        <Button className="w-full h-11" disabled={!ready || sending} onClick={toNewAd}>
          {sending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Rocket className="h-4 w-4 mr-1.5" />} Use it in a new ad
        </Button>
        <p className="text-[11px] text-muted-foreground -mt-2">The picture goes into the ad account’s library (and Ads Manager’s), and New ad opens with it and these words — audience, budget and dates are chosen there. Nothing runs until you make it.</p>
      </div>
    </div>
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
      {(c.words.text || c.words.headline) && <p className="text-xs text-rose-700 dark:text-rose-300">The {c.words.text ? 'primary text' : 'headline'} carries something the house never says in public (a price, a karat, a weight, “shop now”, a number, a hashtag).</p>}
      {broken.length > 0 && <div className="text-xs"><p className="font-semibold">House rules</p><ul className="list-disc pl-4">{broken.map((r, i) => <li key={i}>{r.rule} — {r.note}</li>)}</ul></div>}
      {craft.length > 0 && <div className="text-xs"><p className="font-semibold">Craft</p><ul className="list-disc pl-4">{craft.map((r, i) => <li key={i}><b>{r.aspect}:</b> {r.note}</li>)}</ul></div>}
      {v.fixes.length > 0 && <div className="text-xs"><p className="font-semibold">Do, in this order</p><ol className="list-decimal pl-4">{v.fixes.map((f, i) => <li key={i}>{f}</li>)}</ol></div>}
      {v.strengths.length > 0 && <p className="text-[11px] text-muted-foreground"><b>Keep:</b> {v.strengths.join(' · ')}</p>}
    </div>
  );
}

