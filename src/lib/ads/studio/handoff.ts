/**
 * An ad made in the studio, handed to Ads → New ad (`/ads/new?studio=<key>`): the
 * picture already in the ad account's library, and its words. Kept in this tab's
 * sessionStorage under `HANDOFF_PREFIX + key` — nothing to clean up, nothing shared.
 */

export interface StudioHandoff {
  photos: { hash: string; url: string | null; headline?: string; link?: string }[];
  text: string;
  headline: string;
  goal: 'whatsapp';
  name: string;
}

export const HANDOFF_PREFIX = 'taheri_studio_handoff:';
