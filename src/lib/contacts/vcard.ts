/**
 * Reads a phone's exported address book and works out which entries belong in the shop's
 * book.
 *
 * The tags live inside the names rather than in any structured field — "Altaf TJ",
 * "Umme Kulsoom Halai HOM", "Uzair Naseem Karigar" — and sometimes more than one at once
 * ("Rabyia Asad TJ/HOM") or in brackets ("Aqueel Quetta (tc)"). Everything else in the
 * file is a personal contact and is left alone.
 */

/** Customer marks. Whichever ones a name carries are kept, so you can still tell TJ from HOM. */
const CUSTOMER_TAGS = ['tj', 'hom', 'tc'];
const KARIGAR_TAG = 'karigar';
const ALL_TAGS = [...CUSTOMER_TAGS, KARIGAR_TAG];

export type ContactKind = 'customer' | 'karigar';

export interface RawCard {
  name: string;
  structured: string;
  phones: string[];
}

export interface Contact {
  kind: ContactKind;
  name: string;
  rawName: string;
  tags: string[];
  bothKinds: boolean;
  phones: string[];
  phoneKeys: string[];
}

/**
 * vCard folds long lines by starting the continuation with a space or tab, so the text has
 * to be joined back up before anything is read out of it.
 */
function unfold(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Split "TEL;type=CELL;type=pref:+9234…" into its name, parameters and value. */
function splitLine(line: string): { name: string; params: string[]; value: string } | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  let value = line.slice(colon + 1);
  const [name, ...params] = head.split(';');
  if (params.some((p) => /quoted-printable/i.test(p))) value = decodeQuotedPrintable(value);
  return { name: name.toUpperCase(), params, value };
}

/** Every card in the file, as { name, phones[] }. */
export function parseVCards(text: string): RawCard[] {
  const out: RawCard[] = [];
  for (const block of unfold(text).split(/BEGIN:VCARD/i).slice(1)) {
    const body = block.split(/END:VCARD/i)[0];
    let fn = '';
    let structured = '';
    const phones: string[] = [];
    for (const line of body.split('\n')) {
      const p = splitLine(line.trim());
      if (!p) continue;
      if (p.name === 'FN') fn = p.value.trim();
      // N is Family;Given;Middle;Prefix;Suffix — the tag is sometimes only in here.
      else if (p.name === 'N') structured = p.value.split(';').filter(Boolean).join(' ').trim();
      else if (p.name === 'TEL' && p.value.trim()) phones.push(p.value.trim());
    }
    const name = fn || structured;
    if (!name) continue;
    out.push({ name, structured, phones: [...new Set(phones)] });
  }
  return out;
}

/**
 * Reduce a number to something comparable. The book holds the same number written every
 * way a person might type it — "0308 2469553", "+92 308 2818131", "03003015705" — so
 * matching is done on the last nine digits, which survives every local and +92 spelling
 * without colliding across real subscribers.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

/** Compare names ignoring case, punctuation and spacing. */
export function nameKey(s: string | null | undefined): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tagPattern = new RegExp(`\\b(${ALL_TAGS.join('|')})\\b`, 'gi');

export interface Classified {
  kind: ContactKind;
  tags: string[];
  name: string;
  bothKinds: boolean;
}

/**
 * Decide what a contact is from its name, and give back the name without the marks — the
 * book shows "Altaf", not "Altaf TJ", and the marks are kept separately.
 */
export function classify(rawName: string | null | undefined): Classified | null {
  const found = [...String(rawName ?? '').matchAll(tagPattern)].map((m) => m[1].toLowerCase());
  if (!found.length) return null;

  const isKarigar = found.includes(KARIGAR_TAG);
  const tags = [...new Set(found)];

  // Strip the marks, then tidy the brackets and separators they leave behind.
  const clean = String(rawName)
    .replace(tagPattern, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    // Removing a mark leaves its separator behind — "TJ/LUNA" becomes "/LUNA". Collapse any
    // separator that now has space on one side, while leaving a hyphenated name intact.
    .replace(/(\s+[/&+,-]+\s*|\s*[/&+,-]+\s+)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/&+,-]+|[\s/&+,-]+$/g, '')
    .trim();

  return {
    kind: isKarigar ? 'karigar' : 'customer',
    tags: tags.filter((t) => t !== KARIGAR_TAG),
    // A name that was nothing but its mark keeps the original, so nobody becomes blank.
    name: clean || String(rawName).trim(),
    bothKinds: isKarigar && tags.some((t) => CUSTOMER_TAGS.includes(t)),
  };
}

export interface ExtractResult {
  contacts: Contact[];
  skippedUntagged: number;
  parsed: number;
  mergedDuplicates: number;
}

/**
 * Everything in the file that belongs in the shop's book, de-duplicated against itself.
 * A phone exports the same person more than once, and repeats the same number inside one
 * card, so both are collapsed here rather than being pushed onto the review screen.
 */
export function extractContacts(text: string): ExtractResult {
  const merged = new Map<string, Contact>();
  let skippedUntagged = 0;
  let parsed = 0;
  let mergedDuplicates = 0;

  for (const card of parseVCards(text)) {
    parsed++;
    const c = classify(card.name);
    if (!c) { skippedUntagged++; continue; }

    const phones: string[] = [];
    const seenKeys = new Set<string>();
    for (const p of card.phones) {
      const k = phoneKey(p);
      if (!k || seenKeys.has(k)) continue;
      seenKeys.add(k);
      phones.push(p);
    }

    // Same person, same number, exported twice — one entry.
    const id = `${c.kind}:${nameKey(c.name)}:${[...seenKeys].sort().join(',')}`;
    const prior = merged.get(id);
    if (prior) {
      prior.tags = [...new Set([...prior.tags, ...c.tags])];
      mergedDuplicates++;
      continue;
    }
    merged.set(id, {
      kind: c.kind,
      name: c.name,
      rawName: card.name,
      tags: c.tags,
      bothKinds: c.bothKinds,
      phones,
      phoneKeys: [...seenKeys],
    });
  }

  return { contacts: [...merged.values()], skippedUntagged, parsed, mergedDuplicates };
}
