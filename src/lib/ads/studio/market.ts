/**
 * What the market runs — the Ad studio's research of 2026-09-29, kept as dated findings the
 * Guide shows. Sources were fetched that day: the houses' own sites (prices, WhatsApp buttons,
 * pixels), Google's Ads Transparency Center (their creatives), TikTok profiles, and Meta's own
 * documentation for how the destinations work. Meta's Ad Library and Instagram refused an
 * unsigned reader, so the houses' Meta ads are not seen here — the Competitors tab looks them
 * up through the shop's own connection and links the public Ad Library.
 *
 * Kept as text on purpose: it is a snapshot, dated, not a live feed. Pure data.
 */

import { STORE_BRAND } from '@/lib/store-config';

export const MARKET_AT = '2026-09-29';

export interface Finding { head: string; body: string; who?: string; source?: string }

/** What the houses do again and again. */
const TAHERI_PATTERNS: Finding[] = [
  { head: 'The three-tag sale card', body: 'Making charges waived (“Net gold price”), diamonds 50–70% off, watches off — with dates and cities. The market’s loudest ad.', who: 'Hanif, Waseem, Heritage', source: 'https://www.youtube.com/watch?v=UoVAvflwI8M' },
  { head: 'Age as the headline', body: '“Est. 1925”, “Since 1952/1956”, “500,000+ customers served”.', who: 'Patiala, Waseem, Al Syed' },
  { head: 'Trust in writing', body: 'Published buyback and exchange rates, lifetime guarantees, GIA/IGI certificates.', who: 'Hanif, Damas, Patiala, Mastaani', source: 'https://www.hanifjewellers.com/assurance' },
  { head: 'WhatsApp is the checkout', body: 'A pre-filled message per product, a floating “book an appointment” button, “chat with a consultant”, private viewings.', who: 'Shafaq Habib, Hanif, Mastaani' },
  { head: 'Prices split by tier', body: 'Everyday pieces priced online; bridal and high jewellery “call for price”.', who: 'Hanif, Shafaq Habib, Waseem, Damas' },
  { head: 'Rate × weight, shown', body: 'A live gold-rate page and every price as rate × weight (“estimates; the rate is fixed at purchase”) — rare.', who: 'Fazal, Al Syed Gold', source: 'https://fazaljeweller.com/gold-rate/' },
  { head: 'Named collections in Urdu', body: 'Aroosa, Riwayat, Noor-e-Zar, “Eid Par Sone Ki Choriyan”.', who: 'Damas, Al Syed, Hanif' },
  { head: 'Letterboxed video', body: 'A square photo boxed inside a 9:16 frame by Google’s auto-video — it looks cheap next to a native vertical.', who: 'Hanif, Zanvari, Heritage' },
];

/** What nobody does — the openings. */
const TAHERI_GAPS: Finding[] = [
  { head: 'The Bohra community', body: 'No site or ad found speaks to Dawoodi Bohra buyers; taheri.shop doesn’t say it either. “A Bohra family house since 1989” is unclaimed. Meta can’t target by religion (removed 2022), so it lives in the words, the occasions and the customer list — describe the house, never the viewer.' },
  { head: 'Price transparency as the hook', body: 'Taheri shows karat and weight on every piece and prices it at today’s rate; almost nobody else does. Put it in the ad.' },
  { head: 'A jeweller’s own gold-rate channel', body: 'Only aggregators (Sarafa.pk) run one. Taheri already has a channel and a daily rate post.' },
  { head: 'Investment gold all year', body: 'Others waive making only in sales; Taheri’s investment pieces carry no making and no wastage every day.' },
  { head: 'The pixel', body: 'At least nine of the sites checked carry a Meta pixel; taheri.shop has none (only Google Analytics). Without it Meta can’t retarget someone who looked at a piece or find people like them.' },
  { head: 'Short vertical video', body: 'At the luxury tier TikTok and Reels are nearly empty; only Al Syed Gold is big there (20k followers, 855 videos).' },
];

/** Each house, in a line or two, with where to look. */
export interface House { name: string; city: string; ig?: string; line: string; url?: string }
const TAHERI_HOUSES: House[] = [
  { name: 'Hanif Jewellers', city: 'Lahore · Islamabad · Dubai', ig: 'hanifjewellers', line: '~308k followers. Priced online store; bridal unpriced. Heavy Google ads (“Annual Gold Sale”); celebrities; published buyback. Meta and TikTok pixels.', url: 'https://www.hanifjewellers.com' },
  { name: 'Damas Pakistan', city: 'Lahore', ig: 'damas.pakistan', line: '~130k followers. Catalogue with karat in the name, no prices; “gifts under 1 lac”; named campaigns (Aroosa, Riwayat).', url: 'https://damaspakistan.com' },
  { name: 'Shafaq Habib', city: 'Lahore', ig: 'shafaqhabibjewellery', line: '~95k followers. “Call for price” on bridal; a pre-filled “Order on WhatsApp” on every piece; private viewings.', url: 'https://shafaqhabib.com' },
  { name: 'Fazal Jewellers', city: 'Lahore', ig: 'fazaljewellersofficial', line: '~81k followers. Live gold rate; every price is rate × weight.', url: 'https://fazaljeweller.com' },
  { name: 'Waseem Jewellers', city: 'Lahore, since 1952', line: 'Unpriced catalogue, “Book appointment”; YouTube sale videos (“Mid Season Sale”, “Shop & Win”). Meta pixel.', url: 'https://linktr.ee/WaseemJewellers' },
  { name: 'Patiala Diamonds', city: 'Islamabad, est. 1925', line: '~22k followers. Google ads on age and trust (“Pakistan’s oldest”, “Lifetime guarantee”); GIA stones.' },
  { name: 'Al Syed', city: 'Karachi, since 1956', ig: 'alsyedjewellers_', line: '~16k on Instagram; the strongest TikTok (20k). alsyedgold.com prices every piece with net weight and wastage in grams.', url: 'https://alsyedgold.com' },
  { name: 'Chhotanis', city: 'Karachi', ig: 'chhotanis', line: '~17k followers; site under construction.' },
  { name: 'Ali Javeri', city: 'Karachi', ig: 'alijaverijewelers', line: 'Priced e-store of gold-plated kundan; celebrity wear; Meta pixel.', url: 'https://alijaverijewelers.com' },
  { name: 'Mastaani Diamonds', city: 'Online', line: 'Lab-grown diamonds and moissanite; “chat with a consultant”; education pages; Meta pixel and Google ads.', url: 'https://mastaanidiamonds.com' },
];

/** How Meta's destinations work, for this house (Meta's own documentation, read 2026-09-29). */
export const META_NOTES: Finding[] = [
  { head: 'WhatsApp channel', body: 'Meta announced promoted channels in 2025 but has no objective for channel follows in Ads Manager or its API yet: a link ad to the channel is the route, and follows are counted in WhatsApp, not by Meta.' },
  { head: 'WhatsApp Status', body: 'Ads can run in Status (9:16, beside Instagram stories) when a WhatsApp Business account is linked; Advantage+ placements include it where it has rolled out.' },
  { head: 'WhatsApp or Instagram in one ad', body: 'The “messaging apps” destination sends each person to the app they use most. Engagement goal; not the leads goal.' },
  { head: 'From chats to sales', body: 'Label chats in the WhatsApp Business app (Lead, New order, Paid) within 7 days of the tap, with “share events with Meta” on: ten labelled in 30 days unlocks optimising for purchases, which Meta reports about 10% cheaper per sale. In-app orders aren’t offered in Pakistan, so labels are the way.' },
  { head: 'Learning', body: 'An ad set leaves learning after about 50 results in a week — roughly seven a day. Set the daily budget near seven times the cost of a result, run at least a week, and don’t edit it while it learns.' },
  { head: 'Tired ads', body: 'Meta flags “creative limited” (dearer than your past ads) and “creative fatigue” (twice as dear): change the picture then.' },
  { head: 'The website', body: 'Pixel and Conversions API together, de-duplicated by event id, then website ads can buy page views and retarget viewers. Catalog ads need a price per item and suit an hourly feed at today’s rate.' },
];

// ── House of Mina (research of 2026-09-29: the houses’ sites, /products.json, Google’s Ads Transparency, TikTok) ──

const MINA_PATTERNS: Finding[] = [
  { head: 'Two pricing cultures', body: 'Fine-silver houses show full prices and rarely discount; fashion brands live on permanent sales (Silver Aura’s median “58% off”, Heritage’s “monthly 50%”).', who: 'Zanvari, Nuqrah, Zumorrud, Nadia Chhotani · Silver Aura, Heritage, Tehzib' },
  { head: 'Trust instead of discounts', body: '“Since 1947”, “4th generation”, lifetime replating, buy-back, IGI certificates.', who: 'Zanvari, Nadia Chhotani, Mastaani' },
  { head: 'Google search ads', body: '“Pakistan’s #1 / Original”, free delivery, cash on delivery. Four of twelve run them; Mina runs none.', who: 'Zanvari, Zumorrud, Heritage, Jadeno', source: 'https://adstransparency.google.com/advertiser/AR01811409337625608193' },
  { head: 'Advance on cash on delivery', body: 'Zumorrud asks 50% up front on every COD order; Nadia Chhotani above Rs 100,000.', who: 'Zumorrud, Nadia Chhotani', source: 'https://ordernation.com/blogs/research/state-of-online-shopping-pakistan-2026' },
  { head: 'Free delivery, lower lines', body: 'Free everywhere (Zanvari, Zumorrud, Heritage), over Rs 5,000 (Jadeno) or Rs 10,000 (Nuqrah).' },
  { head: 'Gift menus and seasons', body: 'Eid, wedding “for her / for him”, Azadi up to 30%, Eid flat 20%, first-order codes of 5–20%.', who: 'Zanvari, Zumorrud, Inaara' },
];
const MINA_GAPS: Finding[] = [
  { head: 'The same promises, lower', body: 'Median Rs 14,000 against Zanvari’s 23,250 and Zumorrud’s 17,500, with made-to-order, buy-back and repolish too. Show the price.' },
  { head: 'The gold look', body: '164 of 209 pieces are 21k gold-plated; the reviews say “looks exactly like real gold”. Rivals lead with white metal and moissanite.' },
  { head: 'Customers’ own words', body: '4.81★ from 138 reviews in a local voice. Rivals’ ads use generic claims.' },
  { head: 'Sets and men’s ruby', body: '62 bangle-and-ring sets and 18 natural ruby rings — ranges nobody leads with.' },
  { head: 'Fix first', body: 'Free delivery starts at Rs 20,000, above the median piece. The catalogue has no pixel. The shop’s footer links TikTok to @houseofmina — someone else’s account; the link page and the catalogue dropped it. Its menu sends every page to six empty Heirloom collections (all 95 pieces are drafts), and 50 rings changed address on 24 September — Google still holds the old ones.' },
];
const MINA_HOUSES: House[] = [
  { name: 'Zanvari', city: 'Karachi, since 1947', line: 'Median Rs 23,250. Lifetime replating, buy-back, 30-day exchange; Google ads “Made to order in Karachi”. Meta, TikTok and Google tags.', url: 'https://zanvari.com' },
  { name: 'Zumorrud', city: 'Online', line: 'Median Rs 17,500. Free delivery; 50% advance on COD; 20% off the first order; Google ads with sales.', url: 'https://zumorrud.com' },
  { name: 'Nuqrah', city: 'Online', line: 'Median Rs 9,240. Free shipping over Rs 10,000; “Loved by creators”; Work Wear and Evening edits.', url: 'https://nuqrah.com' },
  { name: 'Nadia Chhotani', city: 'Karachi', line: 'Median Rs 63,500. “4th generation jeweller”; bridal consultations; never on sale.', url: 'https://nadiachhotani.com' },
  { name: 'Mastaani Diamonds', city: 'Online', line: 'Lab-grown diamonds in 925, from Rs 39,900. IGI, lifetime warranty, ships in 2–3 days; a pre-filled WhatsApp.', url: 'https://mastaanidiamonds.com' },
  { name: 'Heritage Jewels', city: 'Malls', line: '55 Google ads since 2022: “Monthly sale up to 50% off · Pakistan’s #1 · Cash on delivery”.', url: 'https://heritagejewels.com.pk' },
  { name: 'Silver Aura', city: 'Online', line: 'Median Rs 25,000; 40% of pieces “on sale” at a median 58% off.', url: 'https://silverauraofficial.com' },
  { name: 'Jadeno', city: 'Online', line: 'Fashion jewellery, median Rs 3,550 — 200–300 live Google ads, 630 TikTok videos: the loudest advertiser in the category.', url: 'https://jadeno.pk' },
];

const MINA = STORE_BRAND === 'mina';
export const PATTERNS = MINA ? MINA_PATTERNS : TAHERI_PATTERNS;
export const GAPS = MINA ? MINA_GAPS : TAHERI_GAPS;
export const HOUSES = MINA ? MINA_HOUSES : TAHERI_HOUSES;
