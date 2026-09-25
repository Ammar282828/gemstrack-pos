/**
 * An ad set's audience, as the Ads pages edit it (AudienceDraft) and as Meta
 * stores it (`targeting`). Pure — the browser builds a draft, the server turns it
 * into Meta's shape, and an existing ad set's targeting is read back into a
 * draft for editing.
 *
 * Editing never loses what the draft doesn't know about: `mergeTargeting`
 * replaces only the keys the draft controls and keeps the rest of Meta's
 * targeting (behaviours, languages, excluded places…) as it was.
 */

export interface GeoPick {
  type: 'country' | 'region' | 'city' | 'subcity' | 'neighborhood' | 'zip' | 'geo_market' | 'place';
  key: string;
  name: string;
  /** "Sindh, Pakistan" — for telling two Hyderabads apart. */
  detail?: string;
  /** Cities (and places): people within this many km of it too. */
  radiusKm?: number;
}
export interface PinPick { type: 'pin'; lat: number; lng: number; radiusKm: number; name: string }
export type Place = GeoPick | PinPick;

export interface Named { id: string; name: string }

export interface AudienceDraft {
  places: Place[];
  ageMin: number;
  ageMax: number;
  gender: 'all' | 'women' | 'men';
  interests: Named[];
  /** Custom audiences to reach (customers, Instagram engagers, lookalikes…) and to leave out. */
  include: Named[];
  exclude: Named[];
  /** Advantage+ audience: Meta may go beyond age, gender and interests when it finds better people. Places and exclusions stay firm. */
  advantage: boolean;
  placements: 'auto' | 'instagram' | 'instagram_facebook';
  /** Where on Instagram, when the placements are chosen by hand. */
  igPositions: string[];
}

/** Explore is not offered: from v26 Meta refuses it as an ad set placement. */
export const IG_POSITIONS: { key: string; label: string }[] = [
  { key: 'stream', label: 'Feed' },
  { key: 'story', label: 'Stories' },
  { key: 'reels', label: 'Reels' },
  { key: 'profile_feed', label: 'Profile feed' },
];
const FB_POSITIONS = ['feed', 'story', 'facebook_reels'];

export const defaultDraft = (): AudienceDraft => ({
  places: [{ type: 'country', key: 'PK', name: 'Pakistan' }],
  ageMin: 18,
  ageMax: 65,
  gender: 'all',
  interests: [],
  include: [],
  exclude: [],
  advantage: true,
  placements: 'instagram',
  igPositions: ['stream', 'story', 'reels'],
});

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
/** Meta's limits: a city's radius 17–80 km, a dropped pin 1–80 km. */
export const cityRadius = (km: number) => clamp(km, 17, 80);
export const pinRadius = (km: number) => clamp(km, 1, 80);

/** The draft in Meta's `targeting` shape. */
export function buildTargeting(d: AudienceDraft): Record<string, unknown> {
  const geo: Record<string, unknown[]> = {};
  const add = (k: string, v: unknown) => { (geo[k] ??= []).push(v); };
  for (const p of d.places) {
    if (p.type === 'pin') {
      add('custom_locations', { latitude: p.lat, longitude: p.lng, radius: pinRadius(p.radiusKm), distance_unit: 'kilometer', name: p.name });
    } else if (p.type === 'country') {
      add('countries', p.key);
    } else if (p.type === 'region') {
      add('regions', { key: p.key });
    } else if (p.type === 'city') {
      add('cities', p.radiusKm ? { key: p.key, radius: cityRadius(p.radiusKm), distance_unit: 'kilometer' } : { key: p.key });
    } else if (p.type === 'zip') {
      add('zips', { key: p.key });
    } else if (p.type === 'place') {
      add('places', { key: p.key, radius: pinRadius(p.radiusKm ?? 5), distance_unit: 'kilometer' });
    } else {
      // subcity, neighborhood, geo_market — Meta's plural of each
      add(p.type === 'neighborhood' ? 'neighborhoods' : p.type === 'subcity' ? 'subcities' : 'geo_markets', { key: p.key });
    }
  }
  if (!Object.keys(geo).length) geo.countries = ['PK'];

  const ageMin = clamp(d.ageMin, 18, 65);
  const ageMax = clamp(Math.max(d.ageMax, ageMin), ageMin, 65);
  // Always said outright: since v23 Meta refuses most targeting that leaves the flag out.
  const t: Record<string, unknown> = {
    geo_locations: { ...geo, location_types: ['home', 'recent'] },
    targeting_automation: { advantage_audience: d.advantage ? 1 : 0 },
  };
  if (d.advantage) {
    // Advantage+ audience: only a minimum age of 18–25 is a hard limit and the maximum is always 65;
    // the ages asked for go in as Meta's starting suggestion.
    t.age_min = Math.min(ageMin, 25);
    t.age_max = 65;
    if (ageMin !== t.age_min || ageMax !== 65) t.age_range = [ageMin, ageMax];
  } else {
    t.age_min = ageMin;
    t.age_max = ageMax;
  }
  if (d.gender !== 'all') t.genders = [d.gender === 'men' ? 1 : 2];
  if (d.interests.length) t.flexible_spec = [{ interests: d.interests.map(i => ({ id: i.id, name: i.name })) }];
  if (d.include.length) t.custom_audiences = d.include.map(a => ({ id: a.id }));
  if (d.exclude.length) t.excluded_custom_audiences = d.exclude.map(a => ({ id: a.id }));
  if (d.placements !== 'auto') {
    const ig = d.igPositions.filter(p => IG_POSITIONS.some(x => x.key === p));
    t.publisher_platforms = d.placements === 'instagram' ? ['instagram'] : ['instagram', 'facebook'];
    t.instagram_positions = ig.length ? ig : ['stream', 'story', 'reels'];
    if (d.placements === 'instagram_facebook') t.facebook_positions = FB_POSITIONS;
  }
  return t;
}

/** Keys of Meta's targeting that the draft decides. */
const CONTROLLED = [
  'geo_locations', 'age_min', 'age_max', 'age_range', 'genders', 'custom_audiences', 'excluded_custom_audiences', 'targeting_automation',
  'publisher_platforms', 'instagram_positions', 'facebook_positions', 'messenger_positions', 'audience_network_positions', 'threads_positions',
];

/** `built` over `existing`: the draft's keys replaced, everything else Meta had kept. */
export function mergeTargeting(existing: Record<string, unknown>, built: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const k of CONTROLLED) delete out[k];
  // Interests are the draft's; other flexible_spec parts (behaviours, demographics) stay.
  const kept = ((existing.flexible_spec as Record<string, unknown>[] | undefined) ?? [])
    .map(spec => { const { interests: _drop, ...rest } = spec; return rest; })
    .filter(spec => Object.keys(spec).length > 0);
  const mine = (built.flexible_spec as Record<string, unknown>[] | undefined) ?? [];
  delete out.flexible_spec;
  const { flexible_spec: _f, ...builtRest } = built;
  Object.assign(out, builtRest);
  if (kept.length || mine.length) out.flexible_spec = [...mine, ...kept];
  return out;
}

type Keyed = { key?: string; name?: string; radius?: number; distance_unit?: string; region?: string; country?: string; country_code?: string };
const km = (r?: number, unit?: string) => (r ? Math.round(unit === 'mile' ? r * 1.609 : r) : undefined);

/** Meta's targeting back into a draft, as far as a draft can say it. */
export function parseTargeting(t: Record<string, unknown> | null | undefined): AudienceDraft {
  const d = defaultDraft();
  if (!t) return d;
  const geo = (t.geo_locations ?? {}) as Record<string, unknown>;
  const places: Place[] = [];
  for (const c of (geo.countries as string[] | undefined) ?? []) places.push({ type: 'country', key: c, name: c === 'PK' ? 'Pakistan' : c });
  for (const r of (geo.regions as Keyed[] | undefined) ?? []) places.push({ type: 'region', key: String(r.key), name: r.name ?? String(r.key), detail: r.country });
  for (const c of (geo.cities as Keyed[] | undefined) ?? []) places.push({ type: 'city', key: String(c.key), name: c.name ?? String(c.key), detail: [c.region, c.country].filter(Boolean).join(', ') || undefined, radiusKm: km(c.radius, c.distance_unit) });
  for (const z of (geo.zips as Keyed[] | undefined) ?? []) places.push({ type: 'zip', key: String(z.key), name: z.name ?? String(z.key) });
  for (const p of (geo.places as Keyed[] | undefined) ?? []) places.push({ type: 'place', key: String(p.key), name: p.name ?? String(p.key), radiusKm: km(p.radius, p.distance_unit) });
  for (const n of (geo.neighborhoods as Keyed[] | undefined) ?? []) places.push({ type: 'neighborhood', key: String(n.key), name: n.name ?? String(n.key) });
  for (const n of (geo.subcities as Keyed[] | undefined) ?? []) places.push({ type: 'subcity', key: String(n.key), name: n.name ?? String(n.key) });
  for (const n of (geo.geo_markets as Keyed[] | undefined) ?? []) places.push({ type: 'geo_market', key: String(n.key), name: n.name ?? String(n.key) });
  for (const c of (geo.custom_locations as Array<{ latitude: number; longitude: number; radius?: number; distance_unit?: string; name?: string; address_string?: string }> | undefined) ?? []) {
    places.push({ type: 'pin', lat: Number(c.latitude), lng: Number(c.longitude), radiusKm: km(c.radius, c.distance_unit) ?? 10, name: c.name || c.address_string || `${Number(c.latitude).toFixed(3)}, ${Number(c.longitude).toFixed(3)}` });
  }
  if (places.length) d.places = places;
  const range = t.age_range as number[] | undefined;
  if (Array.isArray(range) && range.length === 2) { d.ageMin = Number(range[0]); d.ageMax = Number(range[1]); }
  else {
    if (t.age_min) d.ageMin = Number(t.age_min);
    if (t.age_max) d.ageMax = Number(t.age_max);
  }
  const g = (t.genders as number[] | undefined) ?? [];
  d.gender = g.length === 1 ? (g[0] === 1 ? 'men' : 'women') : 'all';
  d.interests = ((t.flexible_spec as Array<{ interests?: Named[] }> | undefined) ?? []).flatMap(s => s.interests ?? []).map(i => ({ id: String(i.id), name: String(i.name ?? i.id) }));
  d.include = ((t.custom_audiences as Named[] | undefined) ?? []).map(a => ({ id: String(a.id), name: String(a.name ?? a.id) }));
  d.exclude = ((t.excluded_custom_audiences as Named[] | undefined) ?? []).map(a => ({ id: String(a.id), name: String(a.name ?? a.id) }));
  d.advantage = Number((t.targeting_automation as { advantage_audience?: number } | undefined)?.advantage_audience ?? 0) === 1;
  const platforms = (t.publisher_platforms as string[] | undefined) ?? [];
  if (!platforms.length) d.placements = 'auto';
  else if (platforms.length === 1 && platforms[0] === 'instagram') d.placements = 'instagram';
  else d.placements = 'instagram_facebook';
  const igp = ((t.instagram_positions as string[] | undefined) ?? []).filter(p => IG_POSITIONS.some(x => x.key === p));
  if (igp.length) d.igPositions = igp;
  return d;
}

const placeLabel = (p: Place) => (p.type === 'pin' ? `${p.name} +${pinRadius(p.radiusKm)} km` : p.radiusKm && (p.type === 'city' || p.type === 'place') ? `${p.name} +${p.radiusKm} km` : p.name);

/** One line: "Karachi +25 km · 22–45 · Women · Jewellery, Gold · Advantage+". */
export function describeAudience(d: AudienceDraft): string {
  const parts = [
    d.places.length ? d.places.map(placeLabel).join(', ') : 'Pakistan',
    `${d.ageMin}–${d.ageMax >= 65 ? '65+' : d.ageMax}`,
    d.gender === 'all' ? 'everyone' : d.gender === 'women' ? 'women' : 'men',
  ];
  if (d.interests.length) parts.push(d.interests.map(i => i.name).join(', '));
  if (d.include.length) parts.push(`in ${d.include.map(a => a.name).join(', ')}`);
  if (d.exclude.length) parts.push(`not ${d.exclude.map(a => a.name).join(', ')}`);
  if (d.advantage) parts.push('Advantage+');
  parts.push(d.placements === 'auto' ? 'all placements' : d.placements === 'instagram' ? 'Instagram only' : 'Instagram and Facebook');
  return parts.join(' · ');
}
