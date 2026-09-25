'use client';

/**
 * Who an ad is shown to — places (with a radius around a city, or around the
 * shop), ages, gender, interests, the house's own audiences in or out,
 * Advantage+ audience, and where on Instagram — with Meta's estimate of how many
 * people that is, refreshed as it changes. Used by New ad and by Campaigns →
 * Audience.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { MapPin, X, Search, Loader2, Sparkles, LocateFixed, Users, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compact } from '@/lib/ads/shape';
import { IG_POSITIONS, cityRadius, type AudienceDraft, type GeoPick, type Named, type Place } from '@/lib/ads/targeting';
import { api } from './ads-kit';

interface InterestHit { id: string; name: string; size: [number, number] | null; path: string | null }
interface AudienceRow { id: string; name: string; kind: string; size: [number, number] | null; ready: boolean }

const CITY_SHORTCUTS = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Hyderabad, Sindh', 'Dubai'];
const INTEREST_SHORTCUTS = ['Jewellery', 'Gold', 'Diamonds', 'Engagement ring', 'Wedding', 'Luxury goods', 'Bridal'];

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const Chip = ({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) => (
  <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 pl-2.5 pr-1 py-0.5 text-xs">
    {children}
    <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-muted min-h-0" aria-label="Remove"><X className="h-3 w-3" /></button>
  </span>
);

const Section = ({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) => (
  <div className="space-y-1.5">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
    {children}
    {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
  </div>
);

export function AudienceEditor({ draft, onChange, goal, currency: _currency }: { draft: AudienceDraft; onChange: (d: AudienceDraft) => void; goal?: string; currency: string }) {
  const set = (patch: Partial<AudienceDraft>) => onChange({ ...draft, ...patch });

  // ── Places ──
  const [placeQ, setPlaceQ] = useState('');
  const placeDq = useDebounced(placeQ);
  const [placeHits, setPlaceHits] = useState<GeoPick[] | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  useEffect(() => {
    if (placeDq.trim().length < 2) { setPlaceHits(null); return; }
    let live = true;
    setPlaceBusy(true);
    api<{ results: GeoPick[] }>(`/api/ads/search?type=place&q=${encodeURIComponent(placeDq.trim())}`)
      .then(d => { if (live) setPlaceHits(d.results); })
      .catch(() => { if (live) setPlaceHits([]); })
      .finally(() => { if (live) setPlaceBusy(false); });
    return () => { live = false; };
  }, [placeDq]);
  const addPlace = (p: Place) => {
    const key = (x: Place) => (x.type === 'pin' ? `pin:${x.lat},${x.lng}` : `${x.type}:${x.key}`);
    // A country covers its cities: picking a city replaces a lone "Pakistan".
    const rest = draft.places.filter(x => key(x) !== key(p) && !(p.type !== 'country' && x.type === 'country' && draft.places.length === 1));
    set({ places: [...rest, p.type === 'city' ? { ...p, radiusKm: p.radiusKm ?? 25 } : p] });
    setPlaceQ(''); setPlaceHits(null);
  };
  const shortcut = async (name: string) => {
    try {
      const d = await api<{ results: GeoPick[] }>(`/api/ads/search?type=place&q=${encodeURIComponent(name)}`);
      const hit = d.results.find(r => r.type === 'city') ?? d.results[0];
      if (hit) addPlace(hit);
    } catch { /* the search box still works */ }
  };
  const [locating, setLocating] = useState(false);
  const nearHere = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => { addPlace({ type: 'pin', lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4), radiusKm: 10, name: 'Around the shop' }); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  const setRadius = (i: number, km: number | undefined) => set({ places: draft.places.map((p, n) => (n === i ? { ...p, radiusKm: km } as Place : p)) });

  // ── Interests ──
  const [intQ, setIntQ] = useState('');
  const intDq = useDebounced(intQ);
  const [intHits, setIntHits] = useState<InterestHit[] | null>(null);
  const [intBusy, setIntBusy] = useState(false);
  useEffect(() => {
    if (intDq.trim().length < 2) { setIntHits(null); return; }
    let live = true;
    setIntBusy(true);
    api<{ results: InterestHit[] }>(`/api/ads/search?type=interest&q=${encodeURIComponent(intDq.trim())}`)
      .then(d => { if (live) setIntHits(d.results); })
      .catch(() => { if (live) setIntHits([]); })
      .finally(() => { if (live) setIntBusy(false); });
    return () => { live = false; };
  }, [intDq]);
  const suggest = async () => {
    setIntBusy(true);
    try { setIntHits((await api<{ results: InterestHit[] }>(`/api/ads/search?type=suggest&names=${encodeURIComponent(draft.interests.map(i => i.name).join(','))}`)).results); }
    catch { setIntHits([]); }
    finally { setIntBusy(false); }
  };
  const addInterest = (i: Named) => { if (!draft.interests.some(x => x.id === i.id)) set({ interests: [...draft.interests, { id: i.id, name: i.name }] }); };

  // ── The house's audiences ──
  const [audiences, setAudiences] = useState<AudienceRow[] | null>(null);
  const [showAud, setShowAud] = useState(draft.include.length + draft.exclude.length > 0);
  useEffect(() => {
    if (!showAud || audiences) return;
    api<{ audiences: AudienceRow[] }>('/api/ads/audiences').then(d => setAudiences(d.audiences)).catch(() => setAudiences([]));
  }, [showAud, audiences]);
  const toggleAud = (a: AudienceRow, list: 'include' | 'exclude') => {
    const other = list === 'include' ? 'exclude' : 'include';
    const on = draft[list].some(x => x.id === a.id);
    set({ [list]: on ? draft[list].filter(x => x.id !== a.id) : [...draft[list], { id: a.id, name: a.name }], [other]: draft[other].filter(x => x.id !== a.id) } as Partial<AudienceDraft>);
  };

  // ── Estimate ──
  const [estimate, setEstimate] = useState<{ lower: number | null; upper: number | null } | null>(null);
  const [estBusy, setEstBusy] = useState(false);
  const estKey = useDebounced(JSON.stringify([draft, goal]), 700);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setEstBusy(true);
    api<{ lower: number | null; upper: number | null }>('/api/ads/estimate', { body: { draft, goal } })
      .then(d => { if (n === seq.current) setEstimate(d); })
      .catch(() => { if (n === seq.current) setEstimate(null); })
      .finally(() => { if (n === seq.current) setEstBusy(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estKey]);

  const ages = Array.from({ length: 48 }, (_, i) => 18 + i);

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm flex items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground shrink-0" />
        {estBusy && !estimate ? <span className="text-muted-foreground">Estimating the audience…</span>
          : estimate?.upper ? <span>About <b>{compact(estimate.lower ?? 0)}–{compact(estimate.upper)}</b> people</span>
          : <span className="text-muted-foreground">Meta gave no estimate for this audience.</span>}
        {estBusy && estimate && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />}
      </div>

      <Section title="Where" hint="People who live in, or were recently in, these places.">
        <div className="flex flex-wrap gap-1.5">
          {draft.places.map((p, i) => (
            <Chip key={p.type === 'pin' ? `pin${i}` : `${p.type}${p.key}`} onRemove={() => set({ places: draft.places.filter((_, n) => n !== i) })}>
              <MapPin className="h-3 w-3" /> {p.name}{p.type !== 'pin' && p.detail ? <span className="text-muted-foreground">, {p.detail}</span> : null}
              {(p.type === 'city' || p.type === 'pin') && (
                <select value={p.radiusKm ?? 0} onChange={e => setRadius(i, Number(e.target.value) || undefined)} className="ml-1 bg-transparent text-xs text-primary outline-none" aria-label="Radius">
                  {p.type === 'city' && <option value={0}>city only</option>}
                  {(p.type === 'pin' ? [1, 2, 3, 5, 8, 10, 15, 25, 40] : [17, 25, 40, 60, 80]).map(k => <option key={k} value={p.type === 'city' ? cityRadius(k) : k}>+{k} km</option>)}
                </select>
              )}
            </Chip>
          ))}
          {!draft.places.length && <span className="text-xs text-destructive">Choose at least one place.</span>}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={placeQ} onChange={e => setPlaceQ(e.target.value)} placeholder="A city, area or country" className="h-10 pl-9 text-base sm:text-sm" />
          {placeBusy && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
          {placeHits && placeQ && (
            <ul className="absolute z-20 mt-1 w-full rounded-lg border bg-popover shadow-lg max-h-64 overflow-y-auto">
              {!placeHits.length && <li className="px-3 py-2 text-sm text-muted-foreground">Nothing by that name.</li>}
              {placeHits.map(h => (
                <li key={`${h.type}${h.key}`}><button type="button" onClick={() => addPlace(h)} className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                  {h.name}{h.detail ? <span className="text-muted-foreground">, {h.detail}</span> : null} <span className="text-[11px] text-muted-foreground">· {h.type}</span>
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CITY_SHORTCUTS.map(c => <button key={c} type="button" onClick={() => shortcut(c)} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground min-h-0"><Plus className="inline h-3 w-3 -mt-0.5" /> {c.split(',')[0]}</button>)}
          <button type="button" onClick={() => addPlace({ type: 'country', key: 'PK', name: 'Pakistan' })} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground min-h-0"><Plus className="inline h-3 w-3 -mt-0.5" /> All Pakistan</button>
          <button type="button" onClick={nearHere} disabled={locating} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground min-h-0">{locating ? <Loader2 className="inline h-3 w-3 animate-spin" /> : <LocateFixed className="inline h-3 w-3 -mt-0.5" />} Around this phone</button>
        </div>
      </Section>

      <div className="grid grid-cols-2 gap-4">
        <Section title="Ages">
          <div className="flex items-center gap-1.5">
            <select value={draft.ageMin} onChange={e => set({ ageMin: Number(e.target.value), ageMax: Math.max(Number(e.target.value), draft.ageMax) })} className="h-10 rounded-md border bg-background px-2 text-sm" aria-label="From age">
              {ages.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <span className="text-muted-foreground">–</span>
            <select value={draft.ageMax} onChange={e => set({ ageMax: Number(e.target.value) })} className="h-10 rounded-md border bg-background px-2 text-sm" aria-label="To age">
              {ages.filter(a => a >= draft.ageMin).map(a => <option key={a} value={a}>{a === 65 ? '65+' : a}</option>)}
            </select>
          </div>
        </Section>
        <Section title="Who">
          <div className="inline-flex rounded-full border p-0.5 text-xs">
            {(['all', 'women', 'men'] as const).map(g => <button key={g} type="button" onClick={() => set({ gender: g })} className={cn('rounded-full px-3 py-1.5 min-h-0', draft.gender === g ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{g === 'all' ? 'Everyone' : g === 'women' ? 'Women' : 'Men'}</button>)}
          </div>
        </Section>
      </div>

      <Section title="Interests" hint={draft.interests.length ? 'Shown to people with any of these interests.' : 'None: Meta finds the people itself (often the cheapest).'}>
        <div className="flex flex-wrap gap-1.5">
          {draft.interests.map(i => <Chip key={i.id} onRemove={() => set({ interests: draft.interests.filter(x => x.id !== i.id) })}>{i.name}</Chip>)}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={intQ} onChange={e => setIntQ(e.target.value)} placeholder="Jewellery, gold, weddings…" className="h-10 pl-9 text-base sm:text-sm" />
          {intBusy && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {INTEREST_SHORTCUTS.map(s => <button key={s} type="button" onClick={() => setIntQ(s)} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground min-h-0">{s}</button>)}
          {draft.interests.length > 0 && <button type="button" onClick={suggest} className="rounded-full border border-primary/40 px-2.5 py-1 text-xs text-primary min-h-0"><Sparkles className="inline h-3 w-3 -mt-0.5" /> More like these</button>}
        </div>
        {intHits && (
          <ul className="rounded-lg border divide-y max-h-60 overflow-y-auto">
            {!intHits.length && <li className="px-3 py-2 text-sm text-muted-foreground">Nothing found.</li>}
            {intHits.map(h => {
              const on = draft.interests.some(x => x.id === h.id);
              return (
                <li key={h.id}><button type="button" disabled={on} onClick={() => addInterest(h)} className={cn('w-full text-left px-3 py-2 text-sm flex items-center gap-2', on ? 'opacity-50' : 'hover:bg-muted')}>
                  <span className="min-w-0 flex-1"><span className="block truncate">{h.name}</span>{h.path && <span className="block text-[11px] text-muted-foreground truncate">{h.path}</span>}</span>
                  {h.size && <span className="text-[11px] text-muted-foreground shrink-0">{compact(h.size[1])}</span>}
                  {!on && <Plus className="h-4 w-4 text-primary shrink-0" />}
                </button></li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="The shop’s audiences">
        {!showAud ? (
          <button type="button" onClick={() => setShowAud(true)} className="text-sm text-primary min-h-0">Include or leave out customers, Instagram engagers, lookalikes…</button>
        ) : !audiences ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Reading the audiences…</p>
          : !audiences.length ? <p className="text-sm text-muted-foreground">None yet — make them on the Audiences tab.</p> : (
          <ul className="rounded-lg border divide-y">
            {audiences.map(a => {
              const inc = draft.include.some(x => x.id === a.id), exc = draft.exclude.some(x => x.id === a.id);
              return (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1"><span className="block text-sm truncate">{a.name}</span><span className="block text-[11px] text-muted-foreground">{a.kind}{a.size ? ` · ${compact(a.size[0])}–${compact(a.size[1])}` : ''}{a.ready ? '' : ' · not ready'}</span></span>
                  <div className="inline-flex rounded-full border p-0.5 text-[11px] shrink-0">
                    <button type="button" onClick={() => toggleAud(a, 'include')} className={cn('rounded-full px-2.5 py-1 min-h-0', inc ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>Reach</button>
                    <button type="button" onClick={() => toggleAud(a, 'exclude')} className={cn('rounded-full px-2.5 py-1 min-h-0', exc ? 'bg-destructive text-destructive-foreground' : 'text-muted-foreground')}>Leave out</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <label className="flex items-start gap-3 rounded-lg border p-3">
        <Switch checked={draft.advantage} onCheckedChange={v => set({ advantage: v })} className="mt-0.5" />
        <span className="text-sm">
          <b>Advantage+ audience</b>
          <span className="block text-xs text-muted-foreground">{draft.advantage
            ? 'On: the ages, gender, interests and audiences above are Meta’s starting point, and it goes beyond them when it finds better people. Places and “leave out” stay firm; nobody under 25 is shown it unless you allow it above.'
            : 'Off: the ages, gender and interests above are strict limits.'}</span>
        </span>
      </label>

      <Section title="Where it appears">
        <div className="inline-flex flex-wrap rounded-full border p-0.5 text-xs">
          {(['instagram', 'instagram_facebook', 'auto'] as const).map(p => <button key={p} type="button" onClick={() => set({ placements: p })} className={cn('rounded-full px-3 py-1.5 min-h-0', draft.placements === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{p === 'instagram' ? 'Instagram only' : p === 'instagram_facebook' ? 'Instagram + Facebook' : 'Everywhere (Meta decides)'}</button>)}
        </div>
        {draft.placements !== 'auto' && (
          <div className="flex flex-wrap gap-1.5">
            {IG_POSITIONS.map(p => {
              const on = draft.igPositions.includes(p.key);
              return <button key={p.key} type="button" onClick={() => set({ igPositions: on ? draft.igPositions.filter(x => x !== p.key) : [...draft.igPositions, p.key] })}
                className={cn('rounded-full border px-2.5 py-1 text-xs min-h-0', on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground')}>{p.label}</button>;
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

