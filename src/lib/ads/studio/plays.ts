/**
 * The Ad studio's plays: what to run, where it sends people and why, one per place a buyer
 * can land — a WhatsApp chat, WhatsApp or Instagram (whichever they use), the WhatsApp channel,
 * the Instagram profile, the website — each with the ad's shape, layout, words to aim for and
 * how to judge it. From the owner's ask (2026-09-29: "target whatsapp channel/insta/dm/whatsapp/
 * website the full scene") and that day's research (market.ts): what the Pakistani houses run,
 * what nobody does, and how Meta's destinations work.
 *
 * "Make this" opens the maker with the play's shape, layout, destination and brief; the photo is
 * the owner's pick. Pure data.
 */

import type { GoalKey } from '@/lib/ads/plan';
import type { AdFormat, AdTemplateId } from './templates';

export interface Play {
  id: string;
  title: string;
  /** Where a tap goes. */
  goal: GoalKey;
  where: string;
  /** Why this play, from the research. */
  why: string;
  format: AdFormat;
  /** Also send the 9:16 version, as one ad (placement asset customisation). */
  pair: boolean;
  template: AdTemplateId;
  cta: string;
  /** What the AI aims for when it writes the words. */
  brief: string;
  /** Link for the website play; the channel's comes from the store's settings. */
  link?: 'piece' | 'investments';
  who: string;
  budget: string;
  judge: string;
  /** Run first. */
  core?: true;
}

export const PLAYS: Play[] = [
  {
    id: 'piece-price', core: true,
    title: 'A piece at today’s price', goal: 'whatsapp', where: 'A WhatsApp chat with the shop',
    why: 'Most Pakistani houses hide prices behind “call for price”; only Fazal and Al Syed show weight turning into price. Taheri prices every piece at today’s rate — the transparency is the hook, and WhatsApp is where the sale closes.',
    format: 'portrait', pair: true, template: 'headline',
    cta: 'Message us for today’s price',
    brief: 'One piece, its karat and weight stated plainly; invite a WhatsApp message for today’s price.',
    who: 'Karachi near the shop; Advantage+ audience with the customer list as its suggestion.',
    budget: 'Always on: about seven chats a day at your usual cost per chat, so Meta can learn (≈50 a week).',
    judge: 'Cost per chat started, and how many chats became a visit or a sale. Label the chats in WhatsApp Business (Lead, New order, Paid): ten labelled in a month lets Meta optimise for sales.',
  },
  {
    id: 'both-apps',
    title: 'Chats where they already are', goal: 'messages', where: 'WhatsApp or Instagram Direct — Meta picks per person',
    why: 'One ad, two inboxes: Meta sends each person to the app they use most. Worth it once someone answers Instagram DMs as fast as WhatsApp.',
    format: 'portrait', pair: true, template: 'band',
    cta: 'Message us — WhatsApp or DM',
    brief: 'Invite a message on whichever app suits them; the piece and its specs, warm and direct.',
    who: 'As the price play.',
    budget: 'In place of the WhatsApp-only ad, not beside it — two ad sets split the learning.',
    judge: 'Cost per conversation across both; watch that DMs get answered within minutes.',
  },
  {
    id: 'rate-channel',
    title: 'Today’s gold rate → the WhatsApp channel', goal: 'channel', where: 'The shop’s WhatsApp channel',
    why: 'Buyers here track the rate like a stock; only aggregators (Sarafa.pk) run a gold-rate channel — no jeweller does. Taheri already posts the rate daily, so the channel gives every follower a reason to stay.',
    format: 'story', pair: false, template: 'rate',
    cta: 'Follow our WhatsApp channel for the rate every morning',
    brief: 'Today’s gold rate from the house, and an invitation to follow the channel for it every morning.',
    who: 'Karachi, broad; people who engaged with the Instagram account.',
    budget: 'Small and steady. With the day’s figures on it, run it for one day and make a new one tomorrow — or choose the layout without figures to run longer.',
    judge: 'Taps on the link (Meta can’t count channel follows yet) and the channel’s follower count in WhatsApp.',
  },
  {
    id: 'heritage-profile',
    title: 'Since 1989 → the Instagram profile', goal: 'profile', where: 'The @collectionstaheri profile',
    why: 'The houses lead with their age (“Est. 1925”, “Since 1952”). @collectionstaheri has about 2,000 followers against 16,000–300,000 for the others: a profile that looks established converts the rest of the funnel.',
    format: 'portrait', pair: true, template: 'heritage',
    cta: 'See the collection',
    brief: 'A generational family house since 1989: craft and trust, one striking piece.',
    who: 'Karachi, broad; lookalike of the customer list.',
    budget: 'A small, steady amount while the profile grows.',
    judge: 'Cost per profile visit; follows (shown in reporting, not optimised for).',
  },
  {
    id: 'website-piece',
    title: 'See it on taheri.shop', goal: 'website', where: 'The piece’s page, priced at today’s rate',
    why: 'taheri.shop prices every piece live, with a bag and checkout — something only a few houses offer. It carries no Meta pixel yet, so Meta can only buy clicks and can’t retarget the people who looked.',
    format: 'square', pair: true, template: 'framed', link: 'piece',
    cta: 'See today’s price on taheri.shop',
    brief: 'The piece, its specs, and that its price is live on the website at today’s rate.',
    who: 'Karachi and Pakistan’s cities; people who engaged with the Instagram account.',
    budget: 'Modest until the pixel is on the site; then it can buy page views and find people like the ones who looked.',
    judge: 'Cost per click now; page views and add-to-bag once the pixel is live.',
  },
  {
    id: 'investment',
    title: 'Investment gold: no making, no wastage', goal: 'whatsapp', where: 'A WhatsApp chat', link: 'investments',
    why: 'The other houses waive making charges only in timed sales. Taheri’s investment pieces carry none all year — a standing offer nobody else makes.',
    format: 'portrait', pair: true, template: 'investment',
    cta: 'Message us for today’s rate',
    brief: 'Investment gold with no making and no wastage charges, all year; weight and karat plainly.',
    who: 'Karachi; business-minded buyers — lookalike of past investment buyers from the customer list.',
    budget: 'Steady; step it up when the rate dips (a timing window, not a sale).',
    judge: 'Cost per chat; chats that ask for a quote.',
  },
  {
    id: 'come-back',
    title: 'Came close, not yet', goal: 'whatsapp', where: 'A WhatsApp chat',
    why: 'People who engaged with the account or bought before already trust the name; a personal nudge beats a broadcast.',
    format: 'portrait', pair: true, template: 'band',
    cta: 'Message us — we’ll set it aside for you',
    brief: 'A warm, personal invitation back; the piece and its specs.',
    who: 'Ads → Audiences: Instagram engagers (365 days) and the customer list — one ad set, as the pools are small.',
    budget: 'Small; these audiences are small and tire quickly — refresh the picture at frequency 3.',
    judge: 'Cost per chat against the always-on ad.',
  },
];

export const playById = (id: string | null | undefined) => PLAYS.find(p => p.id === id) ?? null;
