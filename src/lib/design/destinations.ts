/**
 * Where the Publish sheet can send a design, and what each place needs (docs/features/design-studio-plan.md
 * §1.4/§5.3). Pure: `destinationRows(facts)` turns what the server knows (the house, the person's role,
 * the connections) into the sheet's rows with a reason for each one that is not there; `needsFor` and
 * `pageFor` say what picture a place wants and which page of the design is it, or which size to make.
 * `facts` come from GET /api/design/destinations; nothing here reads the environment.
 */

import type { DestinationId, DestinationNeeds, DestinationRow, DesignPage } from './model';
import { sizeForDestination, sizePreset, type SizePreset } from './sizes';

export interface WhatsAppTarget { key: string; label: string }

/** What the server knows about this house, this person and the connections. */
export interface DestinationFacts {
  /** The owner and marketing (adsGate): the Meta ad row. Staff never see it. */
  mayAds: boolean;
  /** This house has the Meta ad account in the ERP at all. */
  metaAds: boolean;
  /** The house has a website to put pieces on, and the upload relay is set up. */
  website: { on: boolean; configured: boolean };
  /** "Set of the day" (Taheri's home page; Mina has none). */
  featured: boolean;
  /** Edit a piece is on in this house (replacing a site photo). */
  siteEdit: boolean;
  /** The community's groups and the channel, by key (never chat ids). Mina has no channel. */
  whatsapp: { community: boolean; groups: WhatsAppTarget[]; channel: boolean };
  instagram: { configured: boolean; connected: boolean; username: string | null };
}

export type InstagramMode = 'api' | 'share';
export interface DestinationInfo extends DestinationRow {
  /** Instagram rows: posted by the house's connection, or handed to the phone's share sheet. */
  mode?: InstagramMode;
  /** WhatsApp rows: the places a tick can choose from (the channel is `channel`). */
  targets?: WhatsAppTarget[];
}

/** The order the sheet shows them in. */
export const DESTINATION_ORDER: DestinationId[] = ['website', 'featured', 'whatsapp', 'channel', 'instagram-story', 'instagram-post', 'meta-ad', 'site-replace'];

/**
 * What each place takes. `maxPx` is the width the picture is drawn at (for 'any', the longest side it may
 * have). WhatsApp and the website only ever get 1:1 (the owner, 2026-09-25); a story is 1080 × 1920.
 */
const NEEDS: Record<DestinationId, DestinationNeeds> = {
  website: { ratio: '1:1', maxPx: 3000, caption: null },
  featured: { ratio: '1:1', maxPx: 3000, caption: null },
  whatsapp: { ratio: '1:1', maxPx: 1600, caption: 'wa' },
  channel: { ratio: '1:1', maxPx: 1600, caption: 'wa' },
  'instagram-story': { ratio: '9:16', maxPx: 1080, caption: null },
  'instagram-post': { ratio: '1:1', maxPx: 1440, caption: 'ig' },
  'meta-ad': { ratio: 'any', maxPx: 2160, caption: 'ad' },
  'site-replace': { ratio: 'any', maxPx: 3000, caption: null },
};
export const needsFor = (id: DestinationId): DestinationNeeds => NEEDS[id];

const LABEL: Record<DestinationId, string> = {
  website: 'Website',
  featured: 'Set of the day',
  whatsapp: 'WhatsApp groups',
  channel: 'WhatsApp channel',
  'instagram-story': 'Instagram story',
  'instagram-post': 'Instagram post',
  'meta-ad': 'Meta ad',
  'site-replace': 'Replace the photo on the website',
};
export const destinationLabel = (id: DestinationId): string => LABEL[id];

/** The rows for this house and person, each with `available` and, when not, `reason`. */
export function destinationRows(f: DestinationFacts, opts: { fromSite?: boolean } = {}): DestinationInfo[] {
  const row = (id: DestinationId, available: boolean, reason?: string, extra: Partial<DestinationInfo> = {}): DestinationInfo =>
    ({ id, label: LABEL[id], available, ...(available || !reason ? {} : { reason }), needs: NEEDS[id], ...extra });
  const ig = f.instagram;
  const igMode: InstagramMode = ig.connected ? 'api' : 'share';
  const igNote = ig.connected ? undefined : ig.configured ? 'Instagram is not connected — it goes through the phone’s share sheet.' : 'This shop has no Instagram connection — it goes through the phone’s share sheet.';
  const site = f.website.on && f.website.configured;
  const siteReason = !f.website.on ? 'This shop has no website to put pieces on.' : 'Website uploads are not set up (WEBSITE_UPLOAD_SECRET).';
  return [
    row('website', site, siteReason),
    row('featured', site && f.featured, !site ? siteReason : 'This shop has no set of the day.'),
    row('whatsapp', f.whatsapp.community && f.whatsapp.groups.length > 0, 'This shop has no WhatsApp community set.', { targets: f.whatsapp.groups }),
    row('channel', f.whatsapp.community && f.whatsapp.channel, 'This shop has no WhatsApp channel.', { targets: f.whatsapp.channel ? [{ key: 'channel', label: 'Channel' }] : [] }),
    { ...row('instagram-story', true), mode: igMode, ...(igNote ? { reason: igNote } : {}) },
    { ...row('instagram-post', true), mode: igMode, ...(igNote ? { reason: igNote } : {}) },
    row('meta-ad', f.metaAds && f.mayAds, !f.metaAds ? 'This shop has no Meta ad account here.' : 'Meta ads are for the owner and marketing.'),
    row('site-replace', f.siteEdit && !!opts.fromSite, !f.siteEdit ? 'Editing website pieces is off in this shop.' : 'Only a design made from a piece on the website can replace its photo.'),
  ];
}

// ── Which page of the design ─────────────────────────────────────────────────

const RATIO_OF = { '1:1': 1, '9:16': 9 / 16 } as const;
/** Whether a page's shape is the destination's (within a pixel or two of rounding). */
export function matchesRatio(p: Pick<DesignPage, 'frame'>, ratio: DestinationNeeds['ratio']): boolean {
  if (ratio === 'any') return true;
  const r = p.frame.w / p.frame.h;
  return Math.abs(r - RATIO_OF[ratio]) < 0.01;
}

export type PagePick = { page: DesignPage } | { missing: SizePreset; ratio: string };

/** The page a place takes: the master when it fits, else the first that does; none → the size to make. */
export function pageFor(pages: DesignPage[], master: string, id: DestinationId): PagePick {
  const needs = NEEDS[id];
  const fits = pages.filter(p => matchesRatio(p, needs.ratio));
  const page = fits.find(p => p.id === master) ?? fits[0];
  if (page) return { page };
  const missing = sizeForDestination(id);
  return { missing, ratio: missing.ratio };
}

/** A story-shaped page beside an ad's main one, for "one ad, both sizes" (Meta takes the 9:16 as a second asset). */
export const storyPage = (pages: DesignPage[]): DesignPage | undefined => pages.find(p => matchesRatio(p, '9:16'));

/** The width to draw a page at for a place: its own maximum, or (for any shape) the page format's size. */
export function outputPx(id: DestinationId, page: Pick<DesignPage, 'format'>): number {
  const n = NEEDS[id];
  if (n.ratio !== 'any') return n.maxPx;
  return Math.min(n.maxPx, sizePreset(page.format)?.px ?? 1080);
}

/** The words on the sheet's button when a place has no page of its shape. */
export const makeLabel = (m: SizePreset): string => `Make ${m.ratio} from this`;
