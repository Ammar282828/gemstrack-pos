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
  name:            process.env.NEXT_PUBLIC_STORE_NAME            ?? 'MINA',

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
  allowedEmails:   (process.env.NEXT_PUBLIC_STORE_ALLOWED_EMAILS ?? 'potatomasta501@gmail.com,minakhalid00@gmail.com')
                     .split(',').map(e => e.trim()),

  // POS defaults
  defaultMetal:    (process.env.NEXT_PUBLIC_STORE_DEFAULT_METAL ?? 'silver') as 'silver' | 'gold',
} as const;
