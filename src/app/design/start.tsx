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
import { ChipRow, FilterChip, LedgerSection } from '@/components/ledger';
import { cn } from '@/lib/utils';
import type { Fields } from '@/lib/social/editor';
import type { DesignKind, DesignRecord } from '@/lib/design/model';
import { SIZE_GROUPS, sizePreset } from '@/lib/design/sizes';
import { headlineOf, siteFrom } from '@/lib/website/site-photo';
import { SitePicker, type SitePick } from '../website/post/site-picker';
import { SITE_LABEL } from '../ads/studio/studio-kit';
import { authHeaders } from '../ads/ads-kit';
import { KIND_CARDS, isDesignDraft, kindCard, kindLabel, sizeOf, type SizeChoice } from './design-state';
import { SmartInput, type ParsedPhoto } from './slots';
import { fetchSitePhoto, startPhotoOf, type StartPhoto, type StartRequest } from './use-design';
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

const GROUP_LABEL: Record<string, string> = { ads: 'Feed ads', whatsapp: 'WhatsApp', website: 'Website', story: 'Story', more: 'More shapes' };

export function StartScreen({ adsOk, initialKind, photo, onPhoto, onStart, starting, onChoosePhoto, onOpenDraft, onOpenSaved, onSeeAll }: {
  adsOk: boolean;
  /** From the address (?kind=ad): the kind to open on. */
  initialKind?: DesignKind;
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
  const first: DesignKind = cards.some(c => c.kind === initialKind) ? initialKind! : 'piece';
  const [kind, setKind] = useState<DesignKind>(first);
  const [sizes, setSizes] = useState<string[]>(() => kindCard(first).sizes);
  const [custom, setCustom] = useState({ w: 4, h: 5 });
  const [fields, setFields] = useState<Partial<Fields>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data } = useDesigns();
  const { drafts } = useDeviceDrafts();

  const choose = (k: DesignKind) => { setKind(k); setSizes(kindCard(k).sizes); };
  const toggle = (id: string) => setSizes(s => (s.includes(id) ? (s.length > 1 ? s.filter(x => x !== id) : s) : [...s, id]));

  const choices: SizeChoice[] = useMemo(() => sizes.map(id => (id === 'custom' ? { id, custom } : { id })), [sizes, custom]);
  const summary = choices.map(c => sizeOf(c).ratio).join(' + ');

  const onParsed = (f: Partial<Fields>, photos: ParsedPhoto[]) => {
    setFields(prev => ({ ...prev, ...Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === 'string' && v)) }));
    const main = photos.find(p => p.role === 'main') ?? photos[0];
    if (main) onPhoto(startPhotoOf(main));
  };

  const recent = (data?.items ?? []).slice(0, 4);
  const mine = (drafts ?? []).filter(d => isDesignDraft(d.state)).slice(0, 3);
  const haveFields = Object.values(fields).some(Boolean);

  return (
    <div className="space-y-6">
      <section className="space-y-2" aria-label="Paste anything">
        <h2 className="px-1 font-serif text-ios-title3 font-semibold">Start with anything</h2>
        <SmartInput onParsed={onParsed} />
        {haveFields && (
          <p className="px-1 text-ios-foot text-muted-foreground">
            Found: {Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `${k === 'weight' ? 'specs' : k} “${String(v).slice(0, 40)}”`).join(' · ')}{' '}
            <button type="button" className="min-h-0 text-primary" onClick={() => setFields({})}>Clear</button>
          </p>
        )}
      </section>

      <section className="space-y-2" aria-label="What are you making?">
        <h2 className="px-1 font-serif text-ios-title3 font-semibold">What are you making?</h2>
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
          {(['ads', 'whatsapp', 'website', 'story', 'more'] as const).map(g => (
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
        <Button className="h-11 w-full sm:w-auto" disabled={starting} onClick={() => onStart({ kind, sizes: choices, photo, fields })}>
          {starting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Continue
        </Button>
        {!photo && <p className="px-1 text-ios-foot text-muted-foreground">A photograph is optional: without one the design starts on the house’s ground.</p>}
      </section>

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
