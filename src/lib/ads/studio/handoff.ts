/**
 * An ad made in the studio, handed to Ads → New ad (`/ads/new?studio=<key>`): the
 * picture already in the ad account's library, and its words. Kept in this tab's
 * sessionStorage under `HANDOFF_PREFIX + key` — nothing to clean up, nothing shared.
 */

import type { GoalKey } from '@/lib/ads/plan';

export interface StudioHandoff {
  photos: { hash: string; url: string | null; headline?: string; link?: string }[];
  /** The 9:16 version of the one photo, for stories, reels and Status — one ad, both sizes. */
  vertical?: { hash: string; url: string | null } | null;
  text: string;
  headline: string;
  goal: GoalKey;
  /** Where the button goes for the website and channel goals. */
  link?: string;
  name: string;
}

export const HANDOFF_PREFIX = 'taheri_studio_handoff:';
