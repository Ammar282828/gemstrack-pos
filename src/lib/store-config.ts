/**
 * Store configuration — driven entirely by environment variables.
 *
 * Silver store:  set vars in .env.local  (local) or Firebase App Hosting backend A
 * Gold store:    set vars in .env.gold   (local) or Firebase App Hosting backend B
 *
 * All values fall back to the silver (House of Mina) defaults so the app
 * works even if no env vars are set.
 */

/**
 * Every default here is EMPTY, on purpose.
 *
 * They used to be House of Mina's — its bank, its IBAN, its Instagram, its people.
 * That is fine in the repo those values came from and dangerous in this one: a
 * variable merely left out of apphosting.yaml silently resolved to the other shop,
 * and Taheri's live invoices were printing "Bank Al Habib | House of Mina" with that
 * shop's IBAN under it. A customer reading one would have paid the wrong business.
 *
 * A missing setting must print nothing. Blank is a gap somebody notices; another
 * firm's account number is a gap nobody notices until the money has gone.
 */
export const STORE_CONFIG = {
  // App / branding
  name:            process.env.NEXT_PUBLIC_STORE_NAME            ?? 'TAHERI',

  // PDF footer — contacts (all optional, leave blank to omit)
  contact1Name:    process.env.NEXT_PUBLIC_STORE_CONTACT1_NAME   ?? '',
  contact1Number:  process.env.NEXT_PUBLIC_STORE_CONTACT1_NUMBER ?? '',
  contact2Name:    process.env.NEXT_PUBLIC_STORE_CONTACT2_NAME   ?? '',
  contact2Number:  process.env.NEXT_PUBLIC_STORE_CONTACT2_NUMBER ?? '',
  contact3Name:    process.env.NEXT_PUBLIC_STORE_CONTACT3_NAME   ?? '',
  contact3Number:  process.env.NEXT_PUBLIC_STORE_CONTACT3_NUMBER ?? '',
  contact4Name:    process.env.NEXT_PUBLIC_STORE_CONTACT4_NAME   ?? '',
  contact4Number:  process.env.NEXT_PUBLIC_STORE_CONTACT4_NUMBER ?? '',
  contact5Name:    process.env.NEXT_PUBLIC_STORE_CONTACT5_NAME   ?? '',
  contact5Number:  process.env.NEXT_PUBLIC_STORE_CONTACT5_NUMBER ?? '',

  // PDF footer — bank. No longer printed at all; kept so nothing referencing it breaks.
  bankLine:        process.env.NEXT_PUBLIC_STORE_BANK_LINE        ?? '',
  iban:            process.env.NEXT_PUBLIC_STORE_IBAN             ?? '',

  // PDF footer — QR codes
  instagramUrl:    process.env.NEXT_PUBLIC_STORE_INSTAGRAM_URL    ?? '',
  whatsappUrl:     process.env.NEXT_PUBLIC_STORE_WHATSAPP_URL     ?? '',

  // Auth — comma-separated list of allowed Google accounts
  allowedEmails:   (process.env.NEXT_PUBLIC_STORE_ALLOWED_EMAILS ?? 'potatomasta501@gmail.com')
                     .split(',').map(e => e.trim()),

  appUrl:          process.env.NEXT_PUBLIC_APP_URL                ?? '',

  // POS defaults
  defaultMetal:    (process.env.NEXT_PUBLIC_STORE_DEFAULT_METAL ?? 'gold') as 'silver' | 'gold',
} as const;

/**
 * The shop's wordmark. Lives in public/ so it ships with the build rather than
 * depending on anything remote.
 *
 * Taheri's is a high-contrast Didone in near-black — the same treatment as the
 * MINA mark it replaces, dark artwork on transparent, so it sits on the light
 * chrome without a plate behind it. The light-on-dark cut is kept beside it for
 * anywhere the ground goes dark.
 */
/**
 * What this shop typically keeps on a sale, before expenses.
 *
 * Only ever an estimate, and only used where analytics says "Est. profit" -- nothing
 * is priced from it. It matters because it was hardcoded to 0.40, which is a silver
 * shop's margin: on Taheri's gold that overstated estimated profit roughly fourfold,
 * on the one screen anybody would look at to judge how the year is going.
 */
export const STORE_EST_MARGIN = Number(process.env.NEXT_PUBLIC_STORE_EST_MARGIN ?? '0.10');

/**
 * The shop's link page, and what is on it.
 *
 * One QR on an invoice instead of two: a customer with a phone already raised should
 * not have to choose between a WhatsApp code and an Instagram code. Everything lives
 * behind one address.
 *
 * Each link is optional and an empty one is simply not shown -- better a page with
 * three rows than a fourth that goes nowhere. The Google review link especially:
 * pointing that at a guess sends customers to review the wrong business.
 */
export const STORE_LINKS = {
  /** Where the page itself answers. Defaults to /links on this deployment. */
  url:        process.env.NEXT_PUBLIC_STORE_LINKS_URL       ?? '',
  whatsapp:   process.env.NEXT_PUBLIC_STORE_WHATSAPP_URL    ?? '',
  /** The WhatsApp *community* invite, which is not the same as a wa.me chat link. */
  waCommunity: process.env.NEXT_PUBLIC_STORE_WA_COMMUNITY_URL ?? '',
  /** The shop's WhatsApp channel (whatsapp.com/channel/…): the link page's first row; Post a Piece links to it for sharing by hand. */
  waChannel:  process.env.NEXT_PUBLIC_STORE_WA_CHANNEL_URL  ?? '',
  instagram:  process.env.NEXT_PUBLIC_STORE_INSTAGRAM_URL   ?? '',
  tiktok:     process.env.NEXT_PUBLIC_STORE_TIKTOK_URL      ?? '',
  website:    process.env.NEXT_PUBLIC_STORE_WEBSITE_URL     ?? '',
  /** An online shop apart from the website (House of Mina's Shopify store, houseofmina.store). */
  shop:       process.env.NEXT_PUBLIC_STORE_SHOP_URL        ?? '',
  googleReview: process.env.NEXT_PUBLIC_STORE_GOOGLE_REVIEW_URL ?? '',
};

/**
 * The link page's words, per house. The defaults are Taheri's; House of Mina's file
 * states its own. `feature` is the top row — the WhatsApp channel, or the community
 * when a house has no channel — written "lead|tail|line": the lead set large in the
 * house's serif, the tail whispered beside it, the line beneath. `visit` is the
 * footer, one line per row ("\n" between them). An empty value means the default
 * (`||`, not `??`): the local env generator writes another house's variables empty.
 */
const nl = (v: string | undefined) => v?.replace(/\\n/g, '\n').trim();
const [featureLead = '', featureTail = '', featureLine = ''] =
  (process.env.NEXT_PUBLIC_STORE_LINKS_FEATURE || 'Collections|by Taheri|Every new piece, in your Updates — no group to join')
    .split('|').map((s) => s.trim());
export const STORE_LINKS_PAGE = {
  tagline: process.env.NEXT_PUBLIC_STORE_LINKS_TAGLINE || 'Gold born from dust.',
  welcome: process.env.NEXT_PUBLIC_STORE_LINKS_WELCOME
    || 'Everything Taheri, in one place — new pieces as they are finished, the day’s rate, and a way to reach us that is not a queue.',
  feature: { lead: featureLead, tail: featureTail, line: featureLine },
  /** What the website row is called; the site's own host name without it. */
  websiteLabel: process.env.NEXT_PUBLIC_STORE_LINKS_WEBSITE_LABEL ?? '',
  visit: (nl(process.env.NEXT_PUBLIC_STORE_LINKS_VISIT)
    || 'Najmi Market, Shop #40 & #16, Saddar, Karachi\n0335 2275553 · 0326 2275554').split('\n').map((s) => s.trim()).filter(Boolean),
};

/**
 * Is this hostname the shop's link page (links.taheri.shop for Taheri)? Read
 * from NEXT_PUBLIC_STORE_LINKS_URL, so a shop without one answers no to every
 * host and the middleware never rewrites anything.
 */
export const isLinksHost = (hostname: string): boolean => {
  if (!STORE_LINKS.url) return false;
  let host = '';
  try { host = new URL(STORE_LINKS.url).hostname.toLowerCase(); } catch { return false; }
  const h = String(hostname || '').toLowerCase();
  return h === host || h === `www.${host}`;
};

/** The address a printed QR should point at. */
export const storeLinksUrl = (): string =>
  STORE_LINKS.url || (STORE_CONFIG.appUrl ? `${STORE_CONFIG.appUrl.replace(/\/$/, '')}/links` : '');

/**
 * Which house this build is. One codebase serves both shops — Taheri at
 * pos.taheri.shop and House of Mina at pos.houseofmina.store — and every
 * difference between them is a value in that backend's apphosting.<env>.yaml,
 * never a fork of the code. `brand` picks the dark palette in globals.css
 * (`.brand-taheri`, `.brand-mina`) and the browser-chrome colour; the logo,
 * its aspect and the counter's names follow below. Defaults are Taheri's.
 */
export const STORE_BRAND = (process.env.NEXT_PUBLIC_STORE_BRAND ?? 'taheri') as 'taheri' | 'mina';
export const STORE_THEME_COLOR = process.env.NEXT_PUBLIC_STORE_THEME_COLOR ?? '#0A1111';

export const STORE_LOGO_URL = process.env.NEXT_PUBLIC_STORE_LOGO_URL ?? '/taheri-logo.png';
/**
 * The same wordmark cut in white, for dark grounds: the sidebar and settings on the
 * dark palette, and the always-dark links page. It fell back to STORE_LOGO_URL, so
 * both houses drew their dark wordmark on their own dark ground — Taheri's charcoal
 * all but invisible, Mina's maroon on maroon wholly so (fixed 2026-09-25). Taheri's
 * white cut is public/taheri-logo-light.png; a house with its own logo sets its own.
 */
export const STORE_LOGO_LIGHT_URL = process.env.NEXT_PUBLIC_STORE_LOGO_LIGHT_URL
  ?? (process.env.NEXT_PUBLIC_STORE_LOGO_URL ? STORE_LOGO_URL : '/taheri-logo-light.png');

/**
 * Who stands at this shop's counter — the "Taken by" list on orders and
 * invoices. A fixed list, not free text, because it is a filter as much as a
 * record. Comma-separated in NEXT_PUBLIC_STORE_TAKEN_BY; Taheri's five by default.
 */
export const STORE_TAKEN_BY: readonly string[] = (process.env.NEXT_PUBLIC_STORE_TAKEN_BY ?? 'Ammar,Murtaza,Huzaifa,Mansoor,Mohammad')
  .split(',').map((n) => n.trim()).filter(Boolean);

/**
 * The wordmark's true width ÷ height, used to size it on PDFs.
 *
 * It was 3195/646 — House of Mina's artwork, left behind when the logo was swapped.
 * Taheri's file is 1528×383, so every invoice and workshop slip drew the wordmark
 * about 24% too wide. Nothing errors when this is wrong; the mark just comes out
 * stretched, which is the kind of thing that is only ever noticed on paper.
 *
 * Measured from public/taheri-logo.png. If the artwork is replaced, remeasure it.
 */
export const STORE_LOGO_ASPECT = Number(process.env.NEXT_PUBLIC_STORE_LOGO_ASPECT) || 1528 / 383;

/**
 * Does this shop keep partner ledgers?
 *
 * Shareholder Finances (/shareholders, the mina_ledger and ammar_ledger
 * collections, and "paid by Mina/Ammar" on an expense) is House of Mina's
 * partnership book. Taheri has no partners in this sense, so its sidebar never
 * linked the page; when the two forks became one codebase that omission came
 * with Taheri's nav and Mina's link vanished. NEXT_PUBLIC_STORE_PARTNERSHIP=1
 * in apphosting.mina.yaml brings it back; Taheri leaves it unset.
 */
export const STORE_PARTNERSHIP = process.env.NEXT_PUBLIC_STORE_PARTNERSHIP === '1';

/**
 * What this shop's website does besides showing photographs.
 *
 * taheri.shop prices pieces by weight at the day's gold rate, so the counter
 * enters weights (Photo Weights) and picks a set of the day. House of Mina's
 * catalogue sells at fixed prices copied from its Shopify store and has
 * neither, so its Website menu is Add Photos alone. Both default on (Taheri);
 * a house sets "0" to turn one off.
 */
export const STORE_WEBSITE_WEIGHTS = process.env.NEXT_PUBLIC_STORE_WEBSITE_WEIGHTS !== '0';
export const STORE_WEBSITE_FEATURED = process.env.NEXT_PUBLIC_STORE_WEBSITE_FEATURED !== '0';

/**
 * Post a Piece — what a new piece's post says by default.
 *
 * The WhatsApp numbers a caption asks customers to write to, comma-separated
 * and printed as given (Taheri: "+923352275553, +923262275554"). Without the
 * variable it falls back to the one number in NEXT_PUBLIC_STORE_WHATSAPP_URL.
 * The metal line starts as this house's usual — 21K for Taheri's gold, 925
 * for House of Mina's silver — and the counter changes it per piece.
 */
export const STORE_WHATSAPP_NUMBERS: string[] = (process.env.NEXT_PUBLIC_STORE_WHATSAPP_NUMBERS ?? '')
  .split(',').map((n) => n.trim()).filter(Boolean);
export const STORE_POST_METAL = process.env.NEXT_PUBLIC_STORE_POST_METAL
  ?? (STORE_CONFIG.defaultMetal === 'silver' ? '925 Sterling Silver' : '21K Yellow Gold');

/**
 * The shop's marks as SVGs, for Post a Piece's story and square: drawn in any
 * colour (their shape filled), so each file only needs to be the shape. The
 * wordmark is "taheri"; the monogram is the "t". A house without a monogram
 * sets it to "none" and the option disappears. Paths are under public/.
 */
// A blank value (a local .env written by env-for-house) means unset, like on the backend.
export const STORE_MARK_SVG = process.env.NEXT_PUBLIC_STORE_MARK_SVG?.trim() || '/brand/taheri-wordmark.svg';
// "none" means no monogram: App Hosting refuses a variable whose value is "" (the whole rollout fails).
const monogram = process.env.NEXT_PUBLIC_STORE_MONOGRAM_SVG?.trim();
export const STORE_MONOGRAM_SVG = monogram === undefined ? '/brand/taheri-t.svg' : /^(none|off|0)?$/i.test(monogram) ? '' : monogram;

/**
 * Investments by Taheri — the daily gold post the scheduled Claude routine
 * files in the POS (Website → Investments). Taheri's; a house without the
 * series sets "0".
 */
export const STORE_INVESTMENTS = process.env.NEXT_PUBLIC_STORE_INVESTMENTS !== '0';

/**
 * Post a Piece — the Instagram story, the community post and the AI behind
 * them. Built on Taheri's accounts (@collectionstaheri, the Taheri Collections
 * community, the shop's marks); a house without them sets "0" and the page,
 * its menu entry and its server routes are gone.
 */
export const STORE_POST_PIECE = process.env.NEXT_PUBLIC_STORE_POST_PIECE !== '0';

/**
 * Posts → From the website: a piece already on this house's website (picked,
 * searched or shuffled) goes to its WhatsApp community with its link. Both
 * houses; "0" turns it off. The caption ends with the house's own lines when
 * `_POST_FOOTER` is set (Mina: DM to order, card / bank transfer, worldwide
 * shipping), else "Ask for today's price" and the WhatsApp numbers; `_POST_TAGLINE`
 * follows the piece's facts ("Bespoke, designed in-house."). A literal "\n" in
 * either is a line break.
 */
export const STORE_SITE_POSTS = process.env.NEXT_PUBLIC_STORE_SITE_POSTS !== '0';

/**
 * Ads — this house's Meta ad account in the POS (/ads): what the ads cost and
 * brought, running them, creating them, audiences. Both houses, each with its
 * own Facebook connection and ad account; "0" turns it off. Open like the rest
 * of the POS (the owner, 2026-09-25) — under NEXT_PUBLIC_OPEN_ACCESS anyone
 * with the POS open can create and fund an ad.
 */
export const STORE_META_ADS = process.env.NEXT_PUBLIC_STORE_META_ADS !== '0';
const lines = (v: string | undefined) => (v ?? '').replace(/\\n/g, '\n').trim();
export const STORE_POST_TAGLINE = lines(process.env.NEXT_PUBLIC_STORE_POST_TAGLINE);
export const STORE_POST_FOOTER = lines(process.env.NEXT_PUBLIC_STORE_POST_FOOTER);
