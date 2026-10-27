/**
 * Story drafts (Posts › Stories, 2026-10-27; the owner: "prepare a bunch of Instagram stories, one for every day of
 * the week … make them 9:16 and add text overlays with their weights, and type to make them stand out", then "make
 * 50 more and add them to a stories draft tab in the erp").
 *
 * A draft is a website piece in a running order, one a day, with the line that says what it is ("Ruby bangles ·
 * 21K gold"). Its name and weight are the site's, read when the tab opens, so a weight typed on Photo weights or a
 * renamed piece shows at once; the picture is drawn in the browser (week-story.ts), never stored. What the counter
 * did with each (posted, skipped) is the only thing kept, in Firestore `story_drafts`.
 *
 * The kinds are written by hand rather than worked out: a piece's tags say "Colored Stones" where the counter would
 * say "Navratan", and "21K gold" is written only where the site records the karat (some diamond pieces are 18K).
 */

export interface StoryDraftSeed {
  /** The site's key for the photograph (SitePiece.id). */
  id: string;
  /** What it is, as the story's top line. */
  kind: string;
}

export type StoryDraftStatus = 'posted' | 'skipped';

export interface StoryDraftState {
  status: StoryDraftStatus;
  at: string;
  by: string;
}

/** A draft as the tab shows it: the seed with the piece as the site lists it now. */
export interface StoryDraft {
  id: string;
  /** 1, 2, 3 … its place in the running order. */
  n: number;
  kind: string;
  name: string;
  /** "62.9", "30": grams as the story prints them; '' when the site has none. */
  weight: string;
  /** Not on the website any more (hidden, removed, or the site did not answer for it). */
  missing: boolean;
  state: StoryDraftState | null;
}

const K21 = '21K gold';
const with21 = (kind: string) => `${kind} · ${K21}`;

/** Taheri's running order (the first week went out as files on 2026-10-27, the rest were made for this tab). */
const TAHERI: StoryDraftSeed[] = [
  // Week 1
  { id: 'Wristwear/Stone Bangles/DSC09822.webp', kind: with21('Ruby bangles') },
  { id: 'Sets/Stone Sets/DSC09769.webp', kind: with21('Stone set') },
  { id: 'Rings & Bands/Rings/DSC09767.webp', kind: with21('Ruby ring') },
  { id: 'Chains & Lockets/Taweez/DSC09717.webp', kind: with21('Navratan taweez') },
  { id: 'Chains & Lockets/Taweez/DSC09755.webp', kind: with21('Ruby & enamel taweez') },
  { id: 'Sets/Stone Sets/DSC09768.webp', kind: with21('Necklace set') },
  { id: 'Chains & Lockets/Taweez/DSC09705.webp', kind: with21('Taweez') },
  // Week 2
  { id: 'Sets/Gold Sets/Gold Set 25.webp', kind: 'Meenakari set' },
  { id: 'Rings & Bands/Rings/00_bestseller_02_Ring 77.webp', kind: 'Ruby ring' },
  { id: 'Chains & Lockets/Taweez/DSC09758.webp', kind: with21('Enamel taweez') },
  { id: 'Earrings/Jhumki/00_bestseller_01_Jhumki 28.webp', kind: 'Meenakari jhumki' },
  { id: 'Wristwear/Stone Bangles/Stone Bangle 75.webp', kind: 'Ruby bangles' },
  { id: 'Chains & Lockets/Contemporary Lockets/NR Locket 15.webp', kind: 'Turquoise locket' },
  { id: 'Sets/Gold Sets/Gold Set 59.webp', kind: 'Choker set' },
  // Week 3
  { id: 'Earrings/Diamond Tops/Karay 107 (3).webp', kind: 'Diamond tops' },
  { id: 'Chains & Lockets/Taweez/DSC09685.webp', kind: with21('Taweez') },
  { id: 'Wristwear/Bangles/00_bestseller_02_Bangle 2.webp', kind: 'Bangles' },
  { id: 'Rings & Bands/Rings/Ring 78.webp', kind: 'Emerald ring' },
  { id: 'Sets/Locket Set With Bangle/Locket Set W Bangle 2.webp', kind: 'Amethyst locket set' },
  { id: 'Chains & Lockets/Takhti/Takhti 40.webp', kind: 'Ruby takhti' },
  { id: 'Sets/String Set/String Set 39.webp', kind: 'Emerald string set' },
  // Week 4
  { id: 'Earrings/Tops/Tops 44.webp', kind: 'Coral tops' },
  { id: 'Wristwear/Stone Bangles/hero centre (2).webp', kind: 'Pearl bangles' },
  { id: 'Chains & Lockets/Chains/Chain 54.webp', kind: 'Gold chain' },
  { id: 'Sets/Diamond Sets/Diamond Set (2)-i3OazcoD.webp', kind: 'Diamond set' },
  { id: 'Chains & Lockets/Taweez/DSC09718.webp', kind: with21('Enamel taweez') },
  { id: 'Rings & Bands/Diamond Rings/hero 3.webp', kind: 'Diamond ring' },
  { id: 'Wristwear/Karay/DSC09772.webp', kind: with21('Kara pair') },
  // Week 5
  { id: 'Chains & Lockets/Lockets/Locket 15.webp', kind: 'Meenakari locket' },
  { id: 'Sets/Gold Sets/Gold Set 60.webp', kind: 'Gold set' },
  { id: 'Earrings/Baali/10.webp', kind: 'Emerald baali' },
  { id: 'Wristwear/Stone Bangles/hero 2.webp', kind: 'Ruby bangles' },
  { id: 'Chains & Lockets/Taweez/DSC09719.webp', kind: with21('Ruby taweez') },
  { id: 'Rings & Bands/Rings/DSC06611_overlay.webp', kind: 'Ruby ring' },
  { id: 'Sets/Locket Set With Bangle/Locket Set W Bangle 26.webp', kind: 'Locket set' },
  // Week 6
  { id: 'Earrings/Tops/Tops 30.webp', kind: 'Emerald tops' },
  { id: 'Wristwear/Diamond Bangles/Diamond_Karay-07.webp', kind: 'Diamond bangle' },
  { id: 'Chains & Lockets/Takhti/Takhti 36.webp', kind: 'Takhti' },
  { id: 'Sets/Diamond Sets/Diamond Set (1)-fvnrYFXK.webp', kind: 'Ruby & diamond set' },
  { id: 'Chains & Lockets/Contemporary Lockets/NR Locket 37.webp', kind: 'Emerald locket' },
  { id: 'Chains & Lockets/Taweez/DSC09746.webp', kind: with21('Calligraphy taweez') },
  { id: 'Wristwear/Bangle & Ring/DSC09894_overlay.webp', kind: 'Bangle and ring' },
  // Week 7
  { id: 'Earrings/Jhumki/Jhumki 27.webp', kind: 'Meenakari jhumki' },
  { id: 'Sets/Gold Sets/artisan_emerald_wood_study_1x1_v1 (2).webp', kind: 'Gold set' },
  { id: 'Chains & Lockets/Taweez/DSC09720.webp', kind: with21('Stone taweez') },
  { id: 'Rings & Bands/Bands/Band 131.webp', kind: 'Rose gold band' },
  { id: 'Wristwear/Kara Churi set/hero centre.webp', kind: 'Kara set' },
  { id: 'Sets/Diamond Sets/custom-1x1-v2 (15).webp', kind: 'Diamond set' },
  { id: 'Earrings/Baali/7.webp', kind: 'Meenakari baali' },
  // Week 8
  { id: 'Sets/Stone Sets/Stone Set 6.webp', kind: 'Stone set' },
  { id: 'Chains & Lockets/Taweez/Taweez 1.webp', kind: 'Gold taweez' },
  { id: 'Wristwear/Bangle & Ring/DSC09813_overlay.webp', kind: 'Emerald bangle and ring' },
  { id: 'Sets/String Set/String Set 17.webp', kind: 'Pearl string set' },
  { id: 'Chains & Lockets/Taweez/DSC09688.webp', kind: with21('Taweez') },
  { id: 'Sets/Stone Sets/Stone Set 157.webp', kind: 'Stone set' },
  { id: 'Wristwear/Bangles/magnific_put-this-bangle-on-a-dark_yi6bRRgPW9_overlay.webp', kind: 'Meenakari kara' },
  // Week 9
  { id: 'Wristwear/Bangles/DSC07707_overlay.webp', kind: 'Bangles' },
];

/** Each house's running order. Mina has none yet: the tab is Taheri's until one is written. */
export const STORY_DRAFT_SEEDS: Record<'taheri' | 'mina', StoryDraftSeed[]> = { taheri: TAHERI, mina: [] };

/**
 * "Panjtan Ruby Enamel Taweez II" → "Panjtan Ruby Enamel Taweez", "Ruby Bangle and Ring 22" → "Ruby Bangle and
 * Ring": the site numbers look-alikes; a story names one. A piece called by its number keeps it ("Ring No. 85").
 */
export function storyName(name: string): string {
  const t = name.trim();
  if (/\bNo\.?\s*\d+$/i.test(t)) return t;
  return t.replace(/\s+(?:[IVX]+|\d+)$/, '').trim() || t;
}

/** 62.9 → "62.9", 30 → "30", 16.67 → "16.67": as weighed, at most two decimals, no trailing zeros. */
export function storyWeight(grams: number | null | undefined): string {
  if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0) return '';
  return String(Math.round(grams * 100) / 100);
}

/** 1 → "Week 1 · Mon": where a draft falls if one goes out each day from a Monday. */
export function storyDay(n: number): string {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return `Week ${Math.floor((n - 1) / 7) + 1} · ${days[(n - 1) % 7]}`;
}

/** The seeds as drafts, against the pieces the site lists now and what the counter has done with each. */
export function buildDrafts(
  seeds: StoryDraftSeed[],
  pieces: Map<string, { name: string; weightGrams: number | null; hidden?: boolean }>,
  states: Record<string, StoryDraftState>,
): StoryDraft[] {
  return seeds.map((s, i) => {
    const p = pieces.get(s.id);
    return {
      id: s.id,
      n: i + 1,
      kind: s.kind,
      name: p ? storyName(p.name) : storyName(s.id.split('/').pop()!.replace(/\.webp$/i, '')),
      weight: storyWeight(p?.weightGrams),
      missing: !p || !!p.hidden,
      state: states[s.id] ?? null,
    };
  });
}
