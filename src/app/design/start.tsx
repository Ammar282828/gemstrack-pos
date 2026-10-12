'use client';

/**
 * The start screen (plan §5.2): "What are you making?" — one box that understands whatever is pasted (the smart
 * input, a slot), the kinds (a piece's story and post, a post, a story, WhatsApp, a website photo, an ad, any
 * size), the sizes each starts with and a photograph, then Continue. Below, where you left off: this device's
 * drafts and the last designs saved.
 */

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Globe, ImagePlus, LayoutDashboard, Loader2, Upload, X } from 'lucide-react';
import { DESIGN_KINDS } from '@/lib/design/model';
import { ChipRow, FilterChip, LedgerSection } from '@/components/ledger';
import { cn } from '@/lib/utils';
import { STORE_AD_STUDIO, STORE_POST_PIECE } from '@/lib/store-config';
import type { Fields } from '@/lib/social/editor';
import type { DesignKind, DesignRecord } from '@/lib/design/model';
import { SIZE_GROUPS, sizePreset } from '@/lib/design/sizes';
import { headlineOf, siteFrom } from '@/lib/website/site-photo';
import { SitePicker, type SitePick } from '../website/post/site-picker';
import { SITE_LABEL } from './studio-kit';
import { authHeaders } from '../ads/ads-kit';
import { KIND_CARDS, isDesignDraft, kindCard, kindLabel, sizeOf, type SizeChoice } from './design-state';
import { SmartInput, type LayersResult, type SmartPhoto, type SmartResult } from './smart-input';
import { fetchSitePhoto, startPhotoOf, type StartPhoto, type StartRequest } from './use-design';
import { flatAdRequest, type PlanReview } from './flat-ad';
import type { Play } from '@/lib/ads/studio/plays';
import { useDesigns, useDeviceDrafts } from './saved-shelf';

/** A website piece as a photograph to start from. */
export function startPhotoFromSite(p: SitePick): StartPhoto {
  const f = siteFrom(p);
  return {
    label: p.name,
    load: () => fetchSitePhoto(p.id, !!p.photoSource),
    marked: f.marked,
    source: { siteId: p.id },
    fields: {
      headline: headlineOf(p.name),
      kicker: p.collection && p.collection !== 'Website' ? p.collection : '',
      weight: p.facts.join(' · '),
    },
  };
}

export const startPhotoFromFile = (f: File): StartPhoto => ({ label: f.name, load: async () => f });

/** Pieces the smart input found beyond the one in use: they wait here (this page's life) for their own turn. */
let carried: SmartResult[] = [];

const GROUP_LABEL: Record<string, string> = { ads: 'Feed ads', whatsapp: 'WhatsApp', website: 'Website', story: 'Story', more: 'More shapes' };

export function StartScreen({ adsOk, initialKind, play, onClearPlay, photo, onPhoto, onStart, starting, onChoosePhoto, onOpenDraft, onOpenSaved, onSeeAll }: {
  adsOk: boolean;
  /** From the address (?kind=ad): the kind to open on. */
  initialKind?: DesignKind;
  /** From Ads → Plan's "Make this" (?play=): the ad starts at the play's shape(s), layout and goal. */
  play?: Play | null;
  onClearPlay?: () => void;
  photo: StartPhoto | null;
  onPhoto: (p: StartPhoto | null) => void;
  onStart: (req: StartRequest) => void;
  starting: boolean;
  /** To the Photos section, which hands a photograph back. */
  onChoosePhoto: () => void;
  onOpenDraft: (id: string) => void;
  onOpenSaved: (r: DesignRecord) => void;
  onSeeAll: () => void;
}) {
  const cards = KIND_CARDS.filter(c => adsOk || !c.ads);
  const first: DesignKind = play && cards.some(c => c.kind === 'ad') ? 'ad' : cards.some(c => c.kind === initialKind) ? initialKind! : 'piece';
  const [kind, setKind] = useState<DesignKind>(first);
  const playSizes = (p: Play): string[] => [p.format, ...(p.pair && p.format !== 'story' ? ['story'] : [])].filter(id => id !== 'custom' && !!sizePreset(id));
  const [sizes, setSizes] = useState<string[]>(() => (play && playSizes(play).length ? playSizes(play) : kindCard(first).sizes));
  const [custom, setCustom] = useState({ w: 4, h: 5 });
  const [fields, setFields] = useState<Partial<Fields>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data } = useDesigns();
  const { drafts } = useDeviceDrafts();

  const choose = (k: DesignKind) => { setKind(k); setSizes(kindCard(k).sizes); if (k !== 'ad') onClearPlay?.(); };
  const toggle = (id: string) => setSizes(s => (s.includes(id) ? (s.length > 1 ? s.filter(x => x !== id) : s) : [...s, id]));

  const choices: SizeChoice[] = useMemo(() => sizes.map(id => (id === 'custom' ? { id, custom } : { id })), [sizes, custom]);
  const summary = choices.map(c => sizeOf(c).ratio).join(' + ');

  const [waiting, setWaiting] = useState<SmartResult[]>(carried);
  const [price, setPrice] = useState('');
  const [review, setReview] = useState<PlanReview | null>(null);
  const keep = (list: SmartResult[]) => { carried = list; setWaiting(list); };

  /** One found piece becomes the design to make: its words, its main photograph, its price and the kind it suggests. */
  const use = (r: SmartResult) => {
    setFields(Object.fromEntries(Object.entries(r.fields).filter(([, v]) => typeof v === 'string' && v)));
    setPrice(r.price ? (r.price.text || `PKR ${r.price.amount.toLocaleString('en-PK')}`) : '');
    const main: SmartPhoto | undefined = r.photos[0];
    if (main) onPhoto(startPhotoOf(main));
    const k = DESIGN_KINDS.find(x => x === r.suggestedKind);
    if (k && cards.some(c => c.kind === k)) choose(k);
  };
  /** The smart input's answer: one piece is used at once; several are listed, to use one at a time. */
  const onParsed = (results: SmartResult[]) => {
    if (!results.length) return;
    use(results[0]);
    keep([...results.slice(1), ...waiting]);
  };
  const onLayers = (plan: LayersResult, photo: SmartPhoto) => setReview({ plan, photo });

  const recent = (data?.items ?? []).slice(0, 4);
  const mine = (drafts ?? []).filter(d => isDesignDraft(d.state)).slice(0, 3);
  const haveFields = Object.values(fields).some(Boolean);

  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-label="Paste anything">
        <h2 className="px-1 font-serif text-ios-title3 font-semibold">Start with anything</h2>
        <SmartInput onParsed={onParsed} layers={adsOk} onLayers={onLayers} />
        {review && (
          <PlanReviewCard review={review} onCancel={() => setReview(null)}
            onStart={req => { setReview(null); onStart(req); }} />
        )}
        {waiting.length > 0 && (
          <div className="space-y-1.5 rounded-card bg-card p-3">
            <p className="text-ios-sub font-medium">{waiting.length} more piece{waiting.length === 1 ? '' : 's'} found — one design each</p>
            {waiting.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                {r.photos[0] ? <img src={r.photos[0].url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-md bg-muted" />}
                <span className="min-w-0 flex-1 truncate text-ios-sub">{r.name || r.fields.headline || 'Untitled piece'}</span>
                <Button size="sm" variant="outline" onClick={() => { use(r); keep(waiting.filter((_, n) => n !== i)); }}>Use this one</Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 min-h-0" aria-label="Leave it out" onClick={() => keep(waiting.filter((_, n) => n !== i))}><X className="h-4 w-4" /></Button>
              </div>
            ))}
            <p className="text-ios-foot text-muted-foreground">Using one fills the form below; the others stay here for next.</p>
          </div>
        )}
        {(haveFields || price) && (
          <p className="px-1 text-ios-foot text-muted-foreground">
            Found: {Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k === 'weight' ? 'specs' : k} “${String(v).slice(0, 40)}”`).join(' · ')}{' '}
            <button type="button" className="min-h-0 text-primary" onClick={() => { setFields({}); setPrice(''); }}>Clear</button>
          </p>
        )}
      </section>

      <section className="space-y-2" aria-label="What are you making?">
        <h2 className="px-1 font-serif text-ios-title3 font-semibold">What are you making?</h2>
        {play && kind === 'ad' && (
          <p className="flex items-center gap-2 rounded-card bg-primary/10 p-3 text-ios-sub">
            <span className="min-w-0 flex-1">Making <b>{play.title}</b> — “{play.cta}” · {play.where}</span>
            <button type="button" className="min-h-0 text-primary" onClick={() => { onClearPlay?.(); }}>Not this play</button>
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {cards.map(c => (
            <button key={c.kind} type="button" aria-pressed={kind === c.kind} onClick={() => choose(c.kind)}
              className={cn('min-h-0 rounded-card p-3 text-left transition-colors', kind === c.kind ? 'bg-primary text-primary-foreground' : 'bg-card')}>
              <span className="block text-ios-headline font-semibold">{c.title}</span>
              <span className={cn('block text-ios-foot', kind === c.kind ? 'opacity-80' : 'text-muted-foreground')}>{c.note}</span>
            </button>
          ))}
          {adsOk && (
            <Link href="/design?v=board" className="rounded-card bg-card p-3 text-left">
              <span className="flex items-center gap-1.5 text-ios-headline font-semibold"><LayoutDashboard className="h-4 w-4" /> Board</span>
              <span className="block text-ios-foot text-muted-foreground">Many designs on a canvas</span>
            </Link>
          )}
        </div>

        <div className="space-y-2 pt-1">
          <p className="px-1 text-ios-sub font-medium">Sizes <span className="font-normal text-muted-foreground">{summary}</span></p>
          {(['ads', 'whatsapp', 'website', 'more'] as const).map(g => (
            <div key={g} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 shrink-0 text-ios-foot text-muted-foreground">{GROUP_LABEL[g]}</span>
              {SIZE_GROUPS[g].flatMap(id => { const p = sizePreset(id); return p ? [p] : []; }).map(p => (
                <button key={p.id} type="button" aria-pressed={sizes.includes(p.id)} onClick={() => toggle(p.id)}
                  className={cn('min-h-0 rounded-full border px-3 py-1.5 text-xs', sizes.includes(p.id) ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {p.ratio}
                </button>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-ios-foot text-muted-foreground">Your own</span>
            <button type="button" aria-pressed={sizes.includes('custom')} onClick={() => toggle('custom')}
              className={cn('min-h-0 rounded-full border px-3 py-1.5 text-xs', sizes.includes('custom') ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>W:H</button>
            {sizes.includes('custom') && (
              <span className="inline-flex items-center gap-1 text-xs">
                <RatioBox label="Width" value={custom.w} onValue={w => setCustom(c => ({ ...c, w }))} /> : <RatioBox label="Height" value={custom.h} onValue={h => setCustom(c => ({ ...c, h }))} />
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-2" aria-label="The photograph">
        <h2 className="px-1 font-serif text-ios-title3 font-semibold">The photograph</h2>
        {photo ? (
          <div className="flex items-center gap-2 rounded-card bg-card p-3">
            <ImagePlus className="h-5 w-5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-ios-sub font-medium">{photo.label}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 min-h-0" aria-label="Choose another" onClick={() => onPhoto(null)}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <ChipRow label="Where from">
            <FilterChip title="Browse photos" chosen={false} onClick={onChoosePhoto} />
            <button type="button" onClick={() => setPickerOpen(true)} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-muted-foreground/[.18] bg-card px-[13px] text-ios-sub font-medium"><Globe className="h-4 w-4" /> From {SITE_LABEL}</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-muted-foreground/[.18] bg-card px-[13px] text-ios-sub font-medium"><Upload className="h-4 w-4" /> This device</button>
          </ChipRow>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPhoto(startPhotoFromFile(f)); }} />
        <SitePicker open={pickerOpen} onOpenChange={setPickerOpen} siteName={SITE_LABEL} headers={authHeaders} onAdd={ps => { if (ps[0]) onPhoto(startPhotoFromSite(ps[0])); }} />
        <Button className="h-11 w-full sm:w-auto" disabled={starting} onClick={() => onStart({
          kind, sizes: choices, photo, fields,
          ...(play && kind === 'ad' ? { template: play.template } : {}),
          ...(price || (play && kind === 'ad') ? { copy: { ...(price ? { price } : {}), ...(play && kind === 'ad' ? { goal: play.goal } : {}) } } : {}),
        })}>
          {starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Continue
        </Button>
        {!photo && <p className="px-1 text-ios-foot text-muted-foreground">A photograph is optional: without one the design starts on the house’s ground.</p>}
      </section>

      <p className="px-1 text-ios-foot text-muted-foreground">
        Still on the older screens, for what Design doesn’t do yet:{' '}
        {STORE_POST_PIECE && <><Link href="/design/classic/post" className="text-primary underline">Post a piece (classic)</Link> — restage, paint and lettering with AI</>}
        {STORE_POST_PIECE && adsOk && STORE_AD_STUDIO && ' · '}
        {adsOk && STORE_AD_STUDIO && <><Link href="/design/classic/ad" className="text-primary underline">Ad maker (classic)</Link> — art-directed and painted ads</>}.
      </p>

      {(mine.length > 0 || recent.length > 0) && (
        <LedgerSection title="Where you left off" trailing={<button type="button" className="min-h-0 text-primary" onClick={onSeeAll}>Saved</button>}>
          {mine.map(d => (
            <button key={d.id} type="button" onClick={() => onOpenDraft(d.id)} className="flex min-h-0 w-full items-center gap-3 py-3 text-left">
              <span className="min-w-0 flex-1 truncate text-ios-sub font-medium">{d.title || 'Untitled'}</span>
              <span className="shrink-0 text-ios-foot text-muted-foreground">Draft on this device</span>
            </button>
          ))}
          {recent.map(r => (
            <button key={r.id} type="button" onClick={() => onOpenSaved(r)} className="flex min-h-0 w-full items-center gap-3 py-3 text-left">
              {r.thumb ? <img src={r.thumb} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" /> : <span className="h-10 w-10 shrink-0 rounded-md bg-muted" />}
              <span className="min-w-0 flex-1 truncate text-ios-sub font-medium">{r.name}</span>
              <span className="shrink-0 text-ios-foot text-muted-foreground">{kindLabel(r.kind)}</span>
            </button>
          ))}
        </LedgerSection>
      )}
    </div>
  );
}

/** One side of a custom W:H: typed freely, used once it is a whole number 1–100. */
function RatioBox({ label, value, onValue }: { label: string; value: number; onValue: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <Input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} value={text} aria-label={label} className="h-8 w-12 text-center text-base sm:text-xs"
      onChange={e => { const t = e.target.value.replace(/\D/g, ''); setText(t); const n = Number(t); if (n >= 1 && n <= 100) onValue(n); }}
      onBlur={() => setText(String(value))} />
  );
}

/** What the layer splitter found, to look at before anything is made: the lettering to keep, and whether the piece was cut out. */
function PlanReviewCard({ review, onCancel, onStart }: { review: PlanReview; onCancel: () => void; onStart: (req: StartRequest) => void }) {
  const { plan, photo } = review;
  const layers = (plan.layers as { id: string; text: string }[]);
  const cut = !!plan.cutout;
  // With the piece cut out the picture's own lettering is gone, so the layers replace it; on the whole photograph they would print twice.
  const [keepIds, setKeepIds] = useState<string[]>(() => (cut ? layers.map(l => l.id) : []));
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 rounded-card bg-card p-3" aria-label="Split into layers">
      <p className="text-ios-sub font-medium">{cut ? 'Cut out, with the lettering as layers' : 'Lettering as layers'}</p>
      <div className="flex gap-3">
        <img src={photo.url} alt="" className="h-24 w-24 shrink-0 rounded-md object-cover" />
        <div className="min-w-0 flex-1 space-y-1">
          {layers.length === 0 && <p className="text-ios-foot text-muted-foreground">No lettering was found.</p>}
          {layers.map(l => (
            <label key={l.id} className="flex items-center gap-2 text-ios-foot">
              <input type="checkbox" className="h-4 w-4" checked={keepIds.includes(l.id)} onChange={e => setKeepIds(k => (e.target.checked ? [...k, l.id] : k.filter(x => x !== l.id)))} />
              <span className="min-w-0 flex-1 truncate">{l.text}</span>
            </label>
          ))}
        </div>
      </div>
      {plan.notes.length > 0 && <ul className="space-y-0.5 text-ios-foot text-muted-foreground">{plan.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Not now</Button>
        <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { onStart(await flatAdRequest(review, keepIds)); } finally { setBusy(false); } }}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}Make a design from it
        </Button>
      </div>
    </div>
  );
}
