/**
 * Every size the Design area offers, in one table (plan §5.2/§3.3): Meta's four, the seven more shapes,
 * and the two shop destinations (WhatsApp and the website only ever get 1:1 — the owner, 2026-09-25).
 * Built from the ad studio's formats, so there is one list of frames. Pure.
 */

import { AD_FORMATS, AD_FORMAT_ORDER, MORE_FORMAT_ORDER, type AdFormat } from '@/lib/ads/studio/templates';
import type { Frame } from '@/lib/social/story';
import type { DestinationId } from './model';

export interface SizePreset {
  /** An `AdFormat` key, or 'whatsapp' / 'website'. */
  id: string;
  label: string;
  /** The ratio as people say it: '4:5', '1:1', '1.91:1'. */
  ratio: string;
  frame: Frame;
  /** Width of the exported picture. */
  px: number;
  /** The ad format whose frame this is. */
  format: AdFormat;
  meta: boolean;
}
export type SizeGroup = 'ads' | 'whatsapp' | 'website' | 'story' | 'more';

const fromAd = (id: Exclude<AdFormat, 'custom'>): SizePreset => {
  const f = AD_FORMATS[id];
  return { id, label: f.label, ratio: f.short, frame: f.frame, px: f.px, format: id, meta: f.meta };
};

export const SIZE_PRESETS: SizePreset[] = [
  ...[...AD_FORMAT_ORDER, ...MORE_FORMAT_ORDER].map(fromAd),
  { id: 'whatsapp', label: 'WhatsApp 1:1', ratio: '1:1', frame: { w: 1080, h: 1080 }, px: 1600, format: 'square', meta: false },
  { id: 'website', label: 'Website 1:1', ratio: '1:1', frame: { w: 1080, h: 1080 }, px: 3000, format: 'square', meta: false },
];

/** The size chips, grouped as the resize sheet shows them. */
export const SIZE_GROUPS: Record<SizeGroup, string[]> = {
  ads: [...AD_FORMAT_ORDER],
  whatsapp: ['whatsapp'],
  website: ['website'],
  story: ['story'],
  more: [...MORE_FORMAT_ORDER],
};

export const sizePreset = (id: string): SizePreset | undefined => SIZE_PRESETS.find(p => p.id === id);
export const presetsIn = (g: SizeGroup): SizePreset[] => SIZE_GROUPS[g].map(id => sizePreset(id)).filter((p): p is SizePreset => !!p);

const DEST_SIZE: Record<DestinationId, string> = {
  website: 'website',
  featured: 'website',
  whatsapp: 'whatsapp',
  channel: 'whatsapp',
  'instagram-story': 'story',
  'instagram-post': 'square',
  'meta-ad': 'portrait',
  'site-replace': 'website',
};
/** The size a destination wants its picture in. */
export const sizeForDestination = (d: DestinationId): SizePreset => sizePreset(DEST_SIZE[d])!;
