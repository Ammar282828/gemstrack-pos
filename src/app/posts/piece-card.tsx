'use client';

/**
 * One website piece in the Posts hub's tray: its photo (or its design), the weight on it, its
 * caption, its Instagram story. Each piece picked is a card of its own and keeps its own words and
 * design while the counter looks at another; the hub sends them all with one press, asking each
 * card for its caption and its photo through the handle it registers.
 *
 * What a card does is what From the website did for its one piece (the owner, 2026-09-25 to 09-27):
 * the photo as the site shows it, or with the weight stamped on (stampPhoto, on by default only where
 * the photo doesn't show it), or re-made in the square editor (./piece-design.tsx); the house's
 * caption (sitePieceCaption), editable, or with its line and facts written by AI; and the piece as a
 * 9:16 story (lib/social/site-story.ts), posted straight to Instagram or handed to the share sheet.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLingering } from '@/hooks/use-lingering';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Crop, Download, ExternalLink, Instagram, Loader2, Megaphone, PenLine, RotateCcw, Shuffle, Sparkles, Wand2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { diagnose } from '@/lib/social/diagnose';
import { sitePieceCaption } from '@/lib/social/caption';
import { loadImage, stampPhoto } from '@/lib/social/story';
import { siteStoryJpeg, HOUSE_STORY_COLOURS } from '@/lib/social/site-story';
import { siteDetailsLine } from '@/lib/social/site-design';
import { STORE_BRAND, STORE_MARK_SVG, STORE_META_ADS, STORE_POST_FOOTER, STORE_POST_METAL, STORE_POST_PIECE, STORE_POST_TAGLINE, STORE_SITE_EDIT, STORE_WHATSAPP_NUMBERS } from '@/lib/store-config';
import { FONTS } from '@/app/website/post/fonts';
import { PieceDesignPanel, usePieceDesign } from './piece-design';
import { validWeight, weightForSite } from '@/lib/website/site-weight';

export interface Piece {
  id: string; name: string; url: string; image: string; thumb: string; collection: string; weightGrams: number | null; weightOnPhoto: boolean; facts: string[]; about: string; added: number | null; newArrival: boolean;
  /** The catalogue's photo before it was marked, which a design starts from (Mina). */
  photoSource: string | null; sourceMarked: boolean; hidden?: boolean;
  /** taheri.shop's own photographs ("attributes"), whose weights the counter keeps; the catalogue's ("pieces"). */
  source?: 'attributes' | 'pieces';
  /** A new upload not yet on the site's list: it has no page and takes no weight yet. */
  drop?: boolean;
}
export interface IgStatus { configured: boolean; connected: boolean; username: string | null }

/** What the hub asks of a card when it sends: always the card's latest words and photo. */
export interface CardHandle {
  caption: () => string;
  outgoing: () => Promise<Blob>;
  /** "The photo with 3.84g on it". */
  going: () => string;
  /** A small copy of what goes, when it isn't the website's own photo. */
  preview: () => string | null;
  /** The weight typed for a piece the website has none for: sending saves it there too (null otherwise). */
  newWeight: () => number | null;
}



// A weight as typed, and whether the website should keep it (lib/website/site-weight.ts).
export { validWeight } from '@/lib/website/site-weight';
const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
export const agoLabel = (iso: string) => { const d = daysAgo(iso); return d <= 0 ? 'posted today' : d === 1 ? 'posted yesterday' : `posted ${d} days ago`; };
export const slugOf = (p: Pick<Piece, 'url'>) => p.url.split('/').filter(Boolean).pop()?.replace(/[^\w-]+/g, '-').slice(0, 100) || 'piece';

export function PieceCard({ piece, shown, siteName, posted, photo, token, ig, locked, failed, onRegister, onRemove, onAnother }: {
  piece: Piece;
  /** The card in view; the others stay mounted, keeping their words and design. */
  shown: boolean;
  siteName: string;
  posted?: string;
  /** The website's photograph, through this server, fetched once for the page. */
  photo: (id: string) => Promise<Blob>;
  token: () => Promise<Record<string, string>>;
  ig: IgStatus | null;
  /** The hub is sending. */
  locked: boolean;
  /** Why the last send of this piece failed. */
  failed?: string;
  onRegister: (id: string, h: CardHandle | null) => void;
  onRemove: () => void;
  onAnother: () => void;
}) {
  const { toast } = useToast();
  const p = piece;
  const [weight, setWeight] = useState(p.weightGrams ? String(p.weightGrams) : '');
  // Stamp the weight only where the photo doesn't already show it.
  const [overlay, setOverlay] = useState(!!p.weightGrams && !p.weightOnPhoto);
  const [ink, setInk] = useState<'auto' | 'white' | 'dark'>('auto');
  const [aiWords, setAiWords] = useState<{ line: string; facts: string } | null>(null);
  const [edited, setEdited] = useState(false);
  const houseCaption = (w = weight, words = aiWords) => sitePieceCaption(
    { name: p.name, url: p.url, weightGrams: validWeight(w) ? Number(w) : null, facts: words ? [words.facts] : p.facts, about: words ? words.line : p.about },
    { metal: STORE_POST_METAL, tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER, whatsappNumbers: STORE_WHATSAPP_NUMBERS },
  );
  const [caption, setCaption] = useState(() => houseCaption());
  // Typing a weight keeps an untouched caption in step with it.
  useEffect(() => { if (!edited) setCaption(houseCaption()); }, [weight, aiWords]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState<'ai' | 'story' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [story, setStory] = useState<{ url: string; blob: Blob } | null>(null);
  const storyShown = useLingering(story); // what its dialog shows while closing (hooks/use-lingering.ts)
  const stamped = useRef<{ key: string; blob: Blob } | null>(null);
  const mark = useRef<Promise<HTMLImageElement | null> | null>(null);

  const design = usePieceDesign(p, { weight, onWeight: setWeight, stamped: overlay && validWeight(weight), token, sitePhoto: photo });
  /** The photo that goes out: the design while there is one, else stamped with the weight when the overlay is on. */
  const outgoing = async (): Promise<Blob> => {
    if (design.on) return design.jpeg();
    if (!overlay || !validWeight(weight)) return photo(p.id);
    const key = `${weight}|${ink}`;
    if (stamped.current?.key === key) return stamped.current.blob;
    const blob = await stampPhoto(await loadImage(await photo(p.id)), { text: `${weight.trim()}g`, colour: ink, maxEdge: 2048 });
    stamped.current = { key, blob };
    return blob;
  };
  const going = design.on ? 'Your design of the photo' : overlay && validWeight(weight) ? `The photo with ${weight.trim()}g on it` : 'The photo as it is on the website';
  const goingPhoto = design.on ? design.preview : preview;

  // The hub reads the card through this, so it always gets what the card shows now.
  const self = useRef<CardHandle>(null!);
  self.current = { caption: () => caption, outgoing, going: () => going, preview: () => goingPhoto, newWeight: () => weightForSite(p, weight) };
  useEffect(() => {
    onRegister(p.id, { caption: () => self.current.caption(), outgoing: () => self.current.outgoing(), going: () => self.current.going(), preview: () => self.current.preview(), newWeight: () => self.current.newWeight() });
    return () => onRegister(p.id, null);
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview shows exactly what will go: the stamped photo while the overlay is on.
  useEffect(() => {
    if (design.on || !overlay || !validWeight(weight)) { setPreview(null); return; }
    let alive = true, url = '';
    const t = setTimeout(async () => {
      try { const b = await outgoing(); if (alive) { url = URL.createObjectURL(b); setPreview(url); } }
      catch (e) { if (alive) toast({ title: 'Could not put the weight on', description: e instanceof Error ? e.message : '', variant: 'destructive' }); }
    }, 250);
    return () => { alive = false; clearTimeout(t); if (url) URL.revokeObjectURL(url); };
  }, [overlay, weight, ink, design.on]); // eslint-disable-line react-hooks/exhaustive-deps

  const writeWithAi = async () => {
    setBusy('ai');
    try {
      const res = await fetch('/api/website/site-pieces/caption', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await token()) },
        body: JSON.stringify({ id: p.id, weight: validWeight(weight) ? `${weight.trim()}g` : '' }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(d.error || `${res.status}`), { status: res.status });
      const words = { line: d.line as string, facts: d.facts as string };
      setAiWords(words); setEdited(false); setCaption(houseCaption(weight, words));
      toast({ title: 'Caption written', description: 'Read it over before sending — the link and the closing lines are the house’s own.' });
    } catch (e) {
      const dg = diagnose('caption', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
      toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  /** The piece as a 9:16 story: the photo that would go to WhatsApp, whole, with the name and weight. */
  const makeStory = async () => {
    setBusy('story');
    try {
      mark.current ??= loadImage(STORE_MARK_SVG).catch(() => null);
      const [img, wordmark] = await Promise.all([
        outgoing().then(loadImage),
        mark.current,
        document.fonts.load(`800 100px ${FONTS.headline}`), document.fonts.load(`400 40px ${FONTS.body}`),
      ]);
      // The Maisons are the great houses' pieces, not the house's own metal.
      const details = siteDetailsLine(p.collection, STORE_POST_METAL, validWeight(weight) ? `${weight.trim()}g` : '');
      const headline = design.on ? design.name.trim() || p.name : p.name;
      const blob = await siteStoryJpeg(img, { headline, details }, { marks: wordmark ? { wordmark } : {}, fonts: FONTS }, HOUSE_STORY_COLOURS[STORE_BRAND]);
      setStory(prev => { if (prev) URL.revokeObjectURL(prev.url); return { url: URL.createObjectURL(blob), blob }; });
    } catch (e) {
      toast({ title: 'Couldn’t make the story', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };
  const closeStory = () => setStory(prev => { if (prev) URL.revokeObjectURL(prev.url); return null; });
  const postStory = async () => {
    if (!story) return;
    setBusy('story');
    try {
      const form = new FormData();
      form.set('file', new File([story.blob], 'story.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/instagram/story', { method: 'POST', headers: await token(), body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(d.error || `${res.status}`), { status: res.status });
      toast({ title: `Story posted${ig?.username ? ` to @${ig.username}` : ''}`, description: p.name });
      closeStory();
    } catch (e) {
      const dg = diagnose('instagram', { status: (e as { status?: number }).status, message: e instanceof Error ? e.message : String(e) });
      toast({ title: dg.title, description: dg.fix, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };
  /** By hand: the share sheet on a phone (Instagram is one of its apps), a download elsewhere. */
  const saveStory = async () => {
    if (!story) return;
    const file = new File([story.blob], `${slugOf(p)}-story.jpg`, { type: 'image/jpeg' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch (e) { if ((e as Error).name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = story.url; a.download = file.name; a.click();
  };
  const storyUrl = useRef('');
  storyUrl.current = story?.url ?? '';
  useEffect(() => () => { if (storyUrl.current) URL.revokeObjectURL(storyUrl.current); }, []);

  const off = locked || !!busy;
  return (
    <div className={cn('rounded-xl border overflow-hidden bg-card', !shown && 'hidden')}>
      {/* The photo, or — while it is being designed — the editor in its place. */}
      {design.open
        ? <PieceDesignPanel d={design} piece={p} siteName={siteName} />
        : <a href={p.url} target="_blank" rel="noopener" className="block bg-muted"><img src={goingPhoto ?? p.image} alt={p.name} className="w-full aspect-square object-contain" /></a>}
      <div className="p-3 space-y-3">
        {failed && <p className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">Didn’t go: {failed}</p>}
        {!design.open && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-9 shrink-0" disabled={off} onClick={design.edit}><Crop className="h-4 w-4 mr-1.5" /> {design.on ? 'Change the design' : 'Crop & design'}</Button>
            {design.on
              ? <button type="button" className="ml-auto text-right text-xs leading-tight text-muted-foreground hover:text-foreground inline-flex items-center gap-1" onClick={design.plain}><RotateCcw className="h-3 w-3 shrink-0" /> Use the photo as it is</button>
              : <span className="text-[11px] leading-tight text-muted-foreground">Crop it, put the weight or the logo on, filters…</span>}
          </div>
        )}
        {/* The weight on the photo, as the catalogue's own overlay draws it — or, with a design, as the design's layout does. */}
        <div className="rounded-lg border px-3 py-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {design.on
              ? <span className="text-sm font-medium">Weight</span>
              : <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={overlay} onCheckedChange={setOverlay} /> Weight on the photo</label>}
            <div className="ml-auto flex items-center gap-1">
              <Input value={weight} onChange={e => setWeight(e.target.value.replace(/[^\d.]/g, ''))} onFocus={e => e.currentTarget.select()} inputMode="decimal" placeholder="0.00" className="h-9 w-20 text-right tabular-nums" aria-label="Weight in grams" />
              <span className="text-sm text-muted-foreground">g</span>
            </div>
          </div>
          {overlay && !design.on && (
            <div className="inline-flex rounded-full border p-0.5 text-xs">
              {(['auto', 'white', 'dark'] as const).map(c => (
                <button key={c} type="button" onClick={() => setInk(c)} className={cn('rounded-full px-3 py-1', ink === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{c === 'auto' ? 'Auto colour' : c === 'white' ? 'White' : 'Dark'}</button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            {design.on ? design.weightOn ? 'Your design carries the weight. It also goes in the caption.' : 'Your design has no weight on it — pick a layout with the weight to add it. It goes in the caption.'
              : p.weightOnPhoto
              ? overlay ? 'This photo already shows its weight — with this on it shows twice.' : 'This photo already shows its weight.'
              : overlay && !validWeight(weight) ? 'Type the weight to put it on.' : 'Top-left, in the catalogue’s own lettering. It also goes in the caption.'}
          </p>
          {weightForSite(p, weight) !== null && (
            <p className="text-[11px] font-medium text-primary">{siteName} has no weight for this piece: sending saves {weightForSite(p, weight)}g to it too.</p>
          )}
        </div>
        <div>
          <p className="font-semibold leading-tight">{p.name}</p>
          <p className="text-xs text-muted-foreground">{[p.collection, p.weightGrams ? `${p.weightGrams}g` : ''].filter(Boolean).join(' · ')}</p>
          <a href={p.url} target="_blank" rel="noopener" className="text-xs text-primary inline-flex items-center gap-1 break-all">{p.url.replace(/^https?:\/\//, '')} <ExternalLink className="h-3 w-3 shrink-0" /></a>
          {posted && <p className="text-xs text-amber-600 mt-1">Already went out — {agoLabel(posted)}.</p>}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">Caption</span>
            <div className="flex items-center gap-2">
              {(edited || aiWords) && <button type="button" className="text-xs text-muted-foreground inline-flex items-center gap-1" onClick={() => { setAiWords(null); setCaption(houseCaption(weight, null)); setEdited(false); }}><RotateCcw className="h-3 w-3" /> House caption</button>}
              <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={off} onClick={writeWithAi}>{busy === 'ai' ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />} Write with AI</Button>
            </div>
          </div>
          <Textarea value={caption} onChange={e => { setCaption(e.target.value); setEdited(true); }} rows={8} className="font-mono text-xs leading-relaxed" disabled={locked} />
        </div>
        <Button variant="outline" className="h-11 w-full" disabled={off} onClick={makeStory}>
          {busy === 'story' && !story ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Instagram className="h-4 w-4 mr-1.5" />} Instagram story{ig?.connected && ig.username ? <span className="ml-1 text-muted-foreground font-normal">· @{ig.username}</span> : null}
        </Button>
        <p className="text-[11px] text-muted-foreground">{going}.</p>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 -mx-2">
          {STORE_POST_PIECE && <Button asChild variant="ghost" size="sm" className="h-8"><Link href={`/website/post?site=${encodeURIComponent(p.id)}`} title="The full designer: story and post, AI retouch, the website"><Wand2 className="h-4 w-4 mr-1.5" /> Post a piece</Link></Button>}
          {STORE_SITE_EDIT && <Button asChild variant="ghost" size="sm" className="h-8"><Link href={`/website/edit?id=${encodeURIComponent(p.id)}`}><PenLine className="h-4 w-4 mr-1.5" /> Edit</Link></Button>}
          {STORE_META_ADS && <Button asChild variant="ghost" size="sm" className="h-8"><Link href={`/ads/new?piece=${encodeURIComponent(p.id)}`}><Megaphone className="h-4 w-4 mr-1.5" /> Promote</Link></Button>}
          <Button variant="ghost" size="sm" className="h-8" disabled={off} onClick={onAnother}><Shuffle className="h-4 w-4 mr-1.5" /> Another</Button>
          <Button variant="ghost" size="sm" className="h-8 ml-auto text-muted-foreground" disabled={locked} onClick={onRemove}><X className="h-4 w-4 mr-1" /> Take out</Button>
        </div>
      </div>

      <AlertDialog open={!!story} onOpenChange={o => { if (!o && busy !== 'story') closeStory(); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{ig?.connected ? `Post this story${ig.username ? ` to @${ig.username}` : ''}?` : 'The story'}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {storyShown && <img src={storyShown.url} alt="The story" className="mx-auto max-h-[55vh] rounded-lg border object-contain" style={{ aspectRatio: '9 / 16' }} />}
                <p className="text-xs">{ig?.connected
                  ? 'It goes up on Instagram at once and can’t be taken down from here. Instagram’s API can’t add a link sticker — add one by hand in the app if you want it.'
                  : ig?.configured ? 'Instagram isn’t connected on this ERP (Post a piece → Instagram connects it), so save it and post it from the Instagram app.'
                  : 'This ERP doesn’t post to Instagram by itself — save it and post it from the Instagram app.'}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'story'}>Not now</AlertDialogCancel>
            <Button variant={ig?.connected ? 'outline' : 'default'} onClick={saveStory} disabled={busy === 'story'}><Download className="h-4 w-4 mr-1.5" /> Save / share</Button>
            {ig?.connected && <Button onClick={postStory} disabled={busy === 'story'}>{busy === 'story' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Instagram className="h-4 w-4 mr-1.5" />} Post story</Button>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
