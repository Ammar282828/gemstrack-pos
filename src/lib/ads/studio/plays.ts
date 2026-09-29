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
import { STORE_BRAND } from '@/lib/store-config';
import type { AdFormat, AdTemplateId } from './templates';

/** The funnel stages the Plan tab groups plays under. */
export type Stage = 'found' | 'talk' | 'priced' | 'back';

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
  stage: Stage;
  /** Link for the website play (the piece's page, the investments page, the online shop); the channel's comes from the store's settings. */
  link?: 'piece' | 'investments' | 'shop';
  /** A page of the shop rather than its front (House of Mina's Ring Builder). */
  path?: string;
  who: string;
  budget: string;
  judge: string;
  /** Run first. */
  core?: true;
}

const TAHERI_PLAYS: Play[] = [
  {
    id: 'piece-price', stage: 'talk', core: true,
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
    id: 'both-apps', stage: 'talk',
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
    id: 'rate-channel', stage: 'found',
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
    id: 'heritage-profile', stage: 'found',
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
    id: 'website-piece', stage: 'priced',
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
    id: 'investment', stage: 'talk',
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
    id: 'come-back', stage: 'back',
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

/**
 * House of Mina (2026-09-29, owner: "do the same thing for houseofmina"): Instagram-native buyers,
 * orders by DM or WhatsApp paid by card or bank transfer and shipped worldwide, the catalogue for the
 * whole range and houseofmina.store to buy online, a men's line.
 */
const MINA_PLAYS: Play[] = [
  {
    id: 'mina-piece', stage: 'talk', core: true,
    title: 'The gold look, the silver price', goal: 'messages', where: 'Instagram Direct or WhatsApp',
    why: 'Mina’s median piece is Rs 14,000 — under Zanvari (23,250) and Zumorrud (17,500) — with the same made-to-order, buy-back and repolish. Most pieces are 21k gold-plated 925. Say the price.',
    format: 'portrait', pair: true, template: 'headline',
    cta: 'DM to order',
    brief: 'One piece in the light; 21k gold-plated 925 silver and its price plainly; made to order in Karachi, shipped worldwide.',
    who: 'Pakistan’s cities and abroad; Advantage+ audience with the customer list as its suggestion.',
    budget: 'Always on, about seven conversations a day.',
    judge: 'Cost per conversation; orders (label chats Lead, New order, Paid).',
  },
  {
    id: 'mina-reviews', stage: 'priced',
    title: 'Their words: a real review', goal: 'sales', where: 'The piece on houseofmina.store', link: 'shop',
    why: '4.81★ from 138 reviews, in a local voice (“the aunties thought it was real”). Rivals’ ads say “Pakistan’s #1”; nobody quotes a customer.',
    format: 'story', pair: false, template: 'headline',
    cta: 'Shop now',
    brief: 'A real customer review, in quotes, as the headline; “4.81★ · 138 reviews” above it; the piece beneath.',
    who: 'Engagers and site visitors first, then a lookalike of buyers.',
    budget: 'Small and steady; change the quote when it tires.',
    judge: 'Cost per order.',
  },
  {
    id: 'mina-ring', stage: 'priced',
    title: 'Design her ring → the Ring Builder', goal: 'sales', where: 'The Ring Builder on houseofmina.store', link: 'shop', path: '/pages/ring-builder',
    why: 'Moissanite solitaires from Rs 7,500 to 27,000; Zanvari’s engagement rings reach 68,900 and Mastaani starts at 39,900.',
    format: 'story', pair: false, template: 'headline',
    cta: 'Design yours',
    brief: 'A moissanite solitaire in 925 silver, from its price; design it yourself.',
    who: 'Engaged and in-a-relationship, 22–35, Pakistan’s cities.',
    budget: 'Steady through the wedding season.',
    judge: 'Cost per order; Ring Builder visits.',
  },
  {
    id: 'mina-sets', stage: 'talk',
    title: 'Bangle & ring, made to match', goal: 'whatsapp', where: 'A WhatsApp chat',
    why: '62 bangle-and-ring sets — a range the other silver houses don’t lead with — sold for the wedding days.',
    format: 'portrait', pair: true, template: 'framed',
    cta: 'Order on WhatsApp',
    brief: 'A matching bangle and ring; for the mehndi, the baraat, the gift.',
    who: 'Women 20–40 in Pakistan’s cities; wedding season.',
    budget: 'Burst in the wedding months.',
    judge: 'Cost per chat; orders.',
  },
  {
    id: 'mina-men', stage: 'talk',
    title: 'Natural ruby, for him', goal: 'messages', where: 'Instagram Direct or WhatsApp',
    why: 'Zanvari sells men’s aqeeq and ruby at Rs 18,000–55,000 with gift and tradition words; Mina has 18 natural ruby rings.',
    format: 'portrait', pair: true, template: 'band',
    cta: 'DM to order',
    brief: 'Natural ruby in 925 silver — for Eid, a nikkah, a father. Short and sure.',
    who: 'Men 22–45 in Pakistan’s cities, and people buying for them.',
    budget: 'Its own ad set, beside the main ad.',
    judge: 'Cost per conversation; orders.',
  },
  {
    id: 'mina-shop', stage: 'priced',
    title: 'Order online → houseofmina.store', goal: 'sales', where: 'houseofmina.store', link: 'shop',
    why: 'Card, bank transfer or cash on delivery, shipped worldwide — for buyers who would rather tap “buy” than message. The shop already carries a Meta pixel.',
    format: 'square', pair: true, template: 'framed',
    cta: 'Shop now',
    brief: 'The piece and its price; cash on delivery or card; shipped worldwide.',
    who: 'Engagers and site visitors; lookalike of buyers.',
    budget: 'Online orders once the pixel records them; Website visits until then.',
    judge: 'Cost per order.',
  },
  {
    id: 'mina-catalogue', stage: 'found',
    title: 'New in → the catalogue', goal: 'website', where: 'The piece’s page on the catalogue', link: 'piece',
    why: 'The whole range, piece by piece. The catalogue carries no pixel yet, so only clicks can be counted.',
    format: 'portrait', pair: true, template: 'band',
    cta: 'See the whole catalogue',
    brief: 'A new piece in the light; see it and the rest on the catalogue.',
    who: 'Followers and engagers, then a lookalike.',
    budget: 'Small bursts when new pieces land.',
    judge: 'Cost per click.',
  },
  {
    id: 'mina-profile', stage: 'found',
    title: 'Follow the house', goal: 'profile', where: 'The @houseofmina__ profile',
    why: 'About 1,200 followers against Zanvari’s 67,000 and Zumorrud’s 9,300: a bigger profile makes every other ad cheaper.',
    format: 'portrait', pair: true, template: 'heritage',
    cta: 'See the collection',
    brief: 'The house in one line and one striking piece.',
    who: 'Broad, Pakistan’s cities; lookalike of the customer list.',
    budget: 'Small and steady.',
    judge: 'Cost per profile visit; follows.',
  },
  {
    id: 'come-back', stage: 'back',
    title: 'Made by hand, kept for life', goal: 'messages', where: 'Instagram Direct or WhatsApp',
    why: 'Cash-on-delivery orders are cancelled about 13 times as often as prepaid ones; the promises settle the doubt.',
    format: 'portrait', pair: true, template: 'band',
    cta: 'DM us — we’ll keep it for you',
    brief: 'Handmade by our karigars · free repolish · buy-back · 7-day returns on defects; the piece in the light.',
    who: 'Ads → Audiences: engagers (365 days), site visitors and the customer list — one ad set.',
    budget: 'Small; refresh the picture at frequency 3.',
    judge: 'Cost per conversation against the always-on ad.',
  },
];

/** This house's plays. */
export const PLAYS: Play[] = STORE_BRAND === 'mina' ? MINA_PLAYS : TAHERI_PLAYS;

/** The Plan tab's stages, in this house's words. */
export const STAGES: { id: Stage; title: string; note: string }[] = STORE_BRAND === 'mina' ? [
  { id: 'found', title: 'Be found', note: 'People who don’t know the house yet: the profile and the catalogue.' },
  { id: 'talk', title: 'Start a conversation', note: 'Where orders close: Instagram Direct and WhatsApp.' },
  { id: 'priced', title: 'Buy online', note: 'houseofmina.store: reviews, the Ring Builder, pay or cash on delivery.' },
  { id: 'back', title: 'Come back', note: 'People who engaged or bought before — the warmest and cheapest.' },
] : [
  { id: 'found', title: 'Be found', note: 'People who don’t know the house yet — the profile and the channel give them a reason to stay.' },
  { id: 'talk', title: 'Start a conversation', note: 'Where the sale closes: WhatsApp, or Instagram Direct for those who live there.' },
  { id: 'priced', title: 'See it priced', note: 'taheri.shop prices every piece at today’s rate — for buyers who want to look first.' },
  { id: 'back', title: 'Come back', note: 'People who engaged or bought before — the warmest and cheapest.' },
];

export const playById = (id: string | null | undefined) => PLAYS.find(p => p.id === id) ?? null;
