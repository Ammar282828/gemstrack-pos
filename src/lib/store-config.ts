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
  /** The shop's WhatsApp channel (whatsapp.com/channel/…). Post a Piece links to it for sharing by hand. */
  waChannel:  process.env.NEXT_PUBLIC_STORE_WA_CHANNEL_URL  ?? '',
  instagram:  process.env.NEXT_PUBLIC_STORE_INSTAGRAM_URL   ?? '',
  website:    process.env.NEXT_PUBLIC_STORE_WEBSITE_URL     ?? '',
  googleReview: process.env.NEXT_PUBLIC_STORE_GOOGLE_REVIEW_URL ?? '',
};

/**
 * The shop's WhatsApp communities, one per line of business.
 *
 * A constant rather than env vars: six labelled links do not fit an environment
 * variable legibly, and NEXT_PUBLIC_* is baked at build time anyway — so a change
 * needs a deploy either way, and this at least reads like a list.
 *
 * The 925 silver community is House of Mina's, deliberately. That shop is the silver
 * side of the business; it is the one place these two are meant to meet.
 *
 * Which is why that row's `tail` reads "House of Mina" where the others read "by
 * Taheri". The tail slot answers "whose", and this is the single row whose answer is
 * different — a customer tapping it leaves Taheri's name behind and should know that
 * before the tap, not after WhatsApp has opened. Five rows agreeing and one differing
 * is not an inconsistency here; it is the only place the page has to say something.
 */
/**
 * `lead` is the word that distinguishes the channel; `tail` is what every channel
 * shares. The link page sets the lead large and the tail as a whisper beside it — this
 * is a jeweller's list of departments, and "by Taheri" said six times in the loudest
 * position on Taheri's own page is noise. `label` keeps the channel's real name for the
 * accessible name, which is what a screen reader announces and what WhatsApp shows on
 * arrival.
 */
export const STORE_COMMUNITIES: { label: string; lead: string; tail: string; sub: string; href: string }[] = [
  { label: 'Taheri Collections', lead: 'Collections', tail: 'by Taheri',      sub: 'The first look at every new piece',
    href: 'https://chat.whatsapp.com/HMeoF0Zcl0i9XobLspaCWl' },
  { label: 'Diamonds by Taheri', lead: 'Diamonds', tail: 'by Taheri',      sub: 'Solitaires, studs and full sets',
    href: 'https://chat.whatsapp.com/CYu06FaabSA9QR3khJbsqK?mode=gi_t' },
  { label: 'Gemstones by Taheri', lead: 'Gemstones', tail: 'by Taheri',     sub: 'Emerald, ruby and sapphire, hand-picked',
    href: 'https://chat.whatsapp.com/Ik4lxzfnVaE3ll9VLh4qbg?mode=gi_t' },
  { label: 'Watches by Taheri', lead: 'Watches', tail: 'by Taheri',       sub: 'What has just reached the counter',
    href: 'https://chat.whatsapp.com/KxWdhie753wBrxw7YpgNSR?mode=gi_t' },
  { label: 'Investments by Taheri', lead: 'Investments', tail: 'by Taheri',   sub: 'Bars, coins and the day\u2019s rate',
    href: 'https://chat.whatsapp.com/FITzh2W8W9eH9Fs2LUWkeA?mode=gi_t' },
  { label: 'Exclusive Sterling Silver', lead: 'Silver', tail: 'House of Mina', sub: 'Everyday pieces in sterling 925',
    href: 'https://chat.whatsapp.com/GspOCiFlp3tJWiNFkLfF0H' },
];

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
 * sets it to "" and the option disappears. Paths are under public/.
 */
export const STORE_MARK_SVG = process.env.NEXT_PUBLIC_STORE_MARK_SVG ?? '/brand/taheri-wordmark.svg';
export const STORE_MONOGRAM_SVG = process.env.NEXT_PUBLIC_STORE_MONOGRAM_SVG ?? '/brand/taheri-t.svg';

/**
 * Investments by Taheri — the daily gold post the scheduled Claude routine
 * files in the POS (Website → Investments). Taheri's; a house without the
 * series sets "0".
 */
export const STORE_INVESTMENTS = process.env.NEXT_PUBLIC_STORE_INVESTMENTS !== '0';
