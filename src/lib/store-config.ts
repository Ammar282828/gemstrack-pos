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
  { label: 'Exclusive Sterling Silver', lead: 'Sterling Silver', tail: 'exclusive', sub: '925 for every day, from House of Mina',
    href: 'https://chat.whatsapp.com/GspOCiFlp3tJWiNFkLfF0H' },
];

/** The address a printed QR should point at. */
export const storeLinksUrl = (): string =>
  STORE_LINKS.url || (STORE_CONFIG.appUrl ? `${STORE_CONFIG.appUrl.replace(/\/$/, '')}/links` : '');

export const STORE_LOGO_URL = '/taheri-logo.png';
export const STORE_LOGO_LIGHT_URL = '/taheri-logo-light.png';

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
export const STORE_LOGO_ASPECT = 1528 / 383;
