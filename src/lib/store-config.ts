/**
 * Store configuration — driven entirely by environment variables.
 *
 * Silver store:  set vars in .env.local  (local) or Firebase App Hosting backend A
 * Gold store:    set vars in .env.gold   (local) or Firebase App Hosting backend B
 *
 * All values fall back to the silver (House of Mina) defaults so the app
 * works even if no env vars are set.
 */

export const STORE_CONFIG = {
  // App / branding
  name:            process.env.NEXT_PUBLIC_STORE_NAME            ?? 'TAHERI',

  // PDF footer — contacts (contact3/4 are optional, leave blank to omit)
  contact1Name:    process.env.NEXT_PUBLIC_STORE_CONTACT1_NAME   ?? 'Mina Khalid',
  contact1Number:  process.env.NEXT_PUBLIC_STORE_CONTACT1_NUMBER ?? '0316 1930960',
  contact2Name:    process.env.NEXT_PUBLIC_STORE_CONTACT2_NAME   ?? 'Ammar Mansa',
  contact2Number:  process.env.NEXT_PUBLIC_STORE_CONTACT2_NUMBER ?? '0326 2275554',
  contact3Name:    process.env.NEXT_PUBLIC_STORE_CONTACT3_NAME   ?? '',
  contact3Number:  process.env.NEXT_PUBLIC_STORE_CONTACT3_NUMBER ?? '',
  contact4Name:    process.env.NEXT_PUBLIC_STORE_CONTACT4_NAME   ?? '',
  contact4Number:  process.env.NEXT_PUBLIC_STORE_CONTACT4_NUMBER ?? '',

  // PDF footer — bank
  bankLine:        process.env.NEXT_PUBLIC_STORE_BANK_LINE        ?? 'Bank Al Habib  |  House of Mina',
  iban:            process.env.NEXT_PUBLIC_STORE_IBAN             ?? 'PK42 BAHL 1227 0981 0022 7801',

  // PDF footer — QR codes
  instagramUrl:    process.env.NEXT_PUBLIC_STORE_INSTAGRAM_URL    ?? 'https://www.instagram.com/houseofmina__?igsh=aTAyZWQycWVudm43&utm_source=qr',
  whatsappUrl:     process.env.NEXT_PUBLIC_STORE_WHATSAPP_URL     ?? 'https://chat.whatsapp.com/GspOCiFlp3tJWiNFkLfF0H',

  // Auth — comma-separated list of allowed Google accounts
  allowedEmails:   (process.env.NEXT_PUBLIC_STORE_ALLOWED_EMAILS ?? 'potatomasta501@gmail.com,minakhalid00@gmail.com,hmurtaza55@gmail.com')
                     .split(',').map(e => e.trim()),

  // POS defaults
  defaultMetal:    (process.env.NEXT_PUBLIC_STORE_DEFAULT_METAL ?? 'silver') as 'silver' | 'gold',
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
