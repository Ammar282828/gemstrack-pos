/**
 * Numbers as they are actually said at this counter.
 *
 * When the assistant asks "how much?", the answer is "saat hazaar" — not "7000". Stripping
 * the non-digits out of that leaves nothing, so it would ask again, and asking twice for
 * something the shop already said plainly is what makes people stop using a thing.
 *
 * Gemini understands all of this, but a round trip to a language model to turn three
 * words into a number is absurd when the vocabulary is this small and this fixed. Kept on
 * the server so the app and WhatsApp read a spoken figure the same way.
 *
 * Returns null rather than a guess whenever the words do not clearly add up to a number —
 * being asked once more is much cheaper than the wrong amount on someone's account.
 */

const UNITS: Record<string, number> = {
  sifar: 0, zero: 0,
  ek: 1, one: 1, aik: 1,
  do: 2, two: 2, doh: 2,
  teen: 3, three: 3, tin: 3,
  char: 4, chaar: 4, four: 4,
  panch: 5, paanch: 5, five: 5, panj: 5,
  che: 6, cheh: 6, chhe: 6, chah: 6, six: 6,
  sat: 7, saat: 7, seven: 7,
  ath: 8, aath: 8, eight: 8,
  nau: 9, no: 9, nine: 9,
  das: 10, dus: 10, ten: 10,
  gyarah: 11, gyara: 11, eleven: 11,
  barah: 12, bara: 12, twelve: 12,
  terah: 13, tera: 13, thirteen: 13,
  chaudah: 14, chauda: 14, chodah: 14, fourteen: 14,
  pandrah: 15, pandra: 15, fifteen: 15,
  solah: 16, sola: 16, sixteen: 16,
  satrah: 17, satra: 17, seventeen: 17,
  atharah: 18, athara: 18, eighteen: 18,
  unees: 19, unnis: 19, nineteen: 19,
  bees: 20, bis: 20, twenty: 20,
  /* The twenties earn their place twice over: they are the karat values as well —
     "ikkis karat" is 21k, "bais" is 22k, "chobis" is pure. */
  ikkis: 21, ikis: 21, ekkis: 21,
  bais: 22, baees: 22, bayees: 22,
  teis: 23, tetis: 23,
  chobis: 24, chaubis: 24, chovis: 24,
  pachees: 25, pachis: 25, pachchis: 25,
  chhabbis: 26, chabbis: 26,
  sattais: 27, satais: 27,
  atthais: 28, athais: 28,
  untees: 29, unattis: 29,
  tees: 30, tis: 30, thirty: 30,
  paintees: 35, pentis: 35,
  paitalees: 45, pentalis: 45,
  pachpan: 55,
  pausath: 65,
  pachhattar: 75, pichhattar: 75,
  pachasi: 85,
  pachanve: 95,
  chalees: 40, chalis: 40, forty: 40,
  pachas: 50, pachaas: 50, fifty: 50,
  saath: 60, sath: 60, sixty: 60,
  sattar: 70, seventy: 70,
  assi: 80, asi: 80, eighty: 80,
  nabbe: 90, nabe: 90, ninety: 90,
  sau: 100, hundred: 100,
};

/** Multipliers, largest first — "dhai lakh pachas hazaar" reads left to right. */
const SCALES: Array<[string, number]> = [
  ['crore', 10000000], ['karor', 10000000], ['karoro', 10000000],
  ['lakh', 100000], ['lac', 100000], ['lakhs', 100000],
  ['hazaar', 1000], ['hazar', 1000], ['hajar', 1000], ['thousand', 1000],
  ['sau', 100], ['hundred', 100],
];

/** Words that carry a fraction of whatever number follows them. */
const FRACTIONS: Record<string, number> = {
  aadha: 0.5, adha: 0.5, half: 0.5,
  derh: 1.5, dedh: 1.5,
  dhai: 2.5, dhaai: 2.5,
  sava: 1.25, sawa: 1.25,
  saade: 0.5, sade: 0.5, sadhe: 0.5,   // "saade chobis" = 24.5 — adds to what follows
  paune: -0.25, pone: -0.25,           // "paune do" = 1.75 — takes off what follows
};

const clean = (s: string | null | undefined) =>
  String(s ?? '')
    .toLowerCase()
    // Digit grouping first, or "20,000" splits into "20" and "000" and reads as twenty.
    .replace(/(\d)[,](\d)/g, '$1$2')
    .replace(/[^\p{L}\p{N}. ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Read a spoken amount.
 *
 * Handles the shapes that actually occur: a bare figure ("7000"), a scaled one
 * ("saat hazaar"), a fractional scale ("dhai lakh", "sava lakh"), and the additive
 * half ("saade chobis gram").
 */
export function spokenNumber(text: string | null | undefined): number | null {
  const words = clean(text).split(' ').filter(Boolean);
  if (!words.length) return null;

  // A plain figure anywhere in the answer wins — "7000 rupees", "20,000".
  const digits = words.find((w) => /^\d+(\.\d+)?$/.test(w));
  if (digits && words.every((w) => /^\d+(\.\d+)?$/.test(w) || !isWordy(w))) {
    const n = parseFloat(digits);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  let total = 0;       // everything already multiplied out by a scale
  let current = 0;     // the run being built up, waiting for its scale
  let pendingHalf = 0; // "saade"/"paune" applies to the number that follows
  let sawAnything = false;

  for (const w of words) {
    if (w in FRACTIONS) {
      const f = FRACTIONS[w];
      // derh / dhai / sava / aadha are complete numbers on their own; saade and paune adjust.
      if (w === 'saade' || w === 'sade' || w === 'sadhe' || w === 'paune' || w === 'pone') {
        pendingHalf = f;
      } else {
        current += f;
        sawAnything = true;
      }
      continue;
    }

    if (/^\d+(\.\d+)?$/.test(w)) {
      current += parseFloat(w) + pendingHalf;
      pendingHalf = 0;
      sawAnything = true;
      continue;
    }

    const scale = SCALES.find(([word]) => word === w);
    if (scale) {
      // "hazaar" with nothing in front of it means one thousand.
      const base = current || 1;
      total += base * scale[1];
      current = 0;
      pendingHalf = 0;
      sawAnything = true;
      continue;
    }

    if (w in UNITS) {
      current += UNITS[w] + pendingHalf;
      pendingHalf = 0;
      sawAnything = true;
      continue;
    }

    // A word that means nothing here — "rupees", "ka", "de", "diye". Ignored, not fatal.
  }

  if (!sawAnything) return null;
  const value = total + current;
  return value > 0 ? Math.round(value * 1000) / 1000 : null;
}

/** Is this word one the parser would recognise, or just filler? */
function isWordy(w: string): boolean {
  return w in UNITS || w in FRACTIONS || SCALES.some(([word]) => word === w);
}

/* ── Reading the numbers out of a mangled transcript ────────────────────────── */

function editRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      cur[j + 1] = Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

const ALL_WORDS = (): string[] => [
  ...Object.keys(UNITS).filter((w) => /^[a-z]+$/.test(w)),
  ...SCALES.map(([w]) => w),
  ...Object.keys(FRACTIONS),
];

export interface FoundNumber {
  heard: string;
  as: string;
  value: number;
}

/**
 * The figures hiding in a mangled transcript.
 *
 * Speech recognition returns "Pichas Hazar" for "pachas hazaar" and "Kaobis" for "chobis" —
 * near-misses that a strict lookup drops on the floor. This snaps each word to the closest
 * number word it plausibly is, and reads the runs that result.
 *
 * The result is offered to the language model as a NOTE beside the transcript, never as a
 * replacement for it. A surname is one bad guess away from a numeral — "Hazari" against
 * "hazaar" scores 0.67 — so a wrong reading here has to be something the model can look
 * past, not something that has already overwritten what was said.
 */
export function findNumbers(text: string | null | undefined): FoundNumber[] {
  const words = clean(text).split(' ').filter(Boolean);
  if (!words.length) return [];
  const vocab = ALL_WORDS();

  const snapped = words.map((w) => {
    if (/^\d+(\.\d+)?$/.test(w)) return { w, as: w, num: true };
    if (vocab.includes(w)) return { w, as: w, num: true };
    let best: string | null = null;
    let score = 0;
    for (const v of vocab) {
      // Only consider words of a similar length; "do" would otherwise absorb anything short.
      if (Math.abs(v.length - w.length) > 2 || w.length < 3) continue;
      const r = editRatio(w, v);
      if (r > score) {
        score = r;
        best = v;
      }
    }
    return score >= 0.78 && best ? { w, as: best, num: true } : { w, as: w, num: false };
  });

  const SCALE_WORDS = new Set(SCALES.map(([w]) => w));
  const FRACTION_WORDS = new Set(Object.keys(FRACTIONS));

  const found: FoundNumber[] = [];
  let run: Array<{ w: string; as: string; num: boolean }> = [];
  const flush = () => {
    let tokens = run;
    run = [];
    if (!tokens.length) return;

    /**
     * "Hazari" is a surname, and it is one letter from "hazaar". A lone scale word carries
     * no quantity, so reading it as a thousand invents a figure nobody said — and doing that
     * to somebody's name is how a hint becomes a wrong amount. A scale needs something in
     * front of it to be a number.
     */
    if (tokens.length === 1 && SCALE_WORDS.has(tokens[0].as)) return;

    /**
     * "diye" comes back as "Dhai", which really is a number word — so "tees hazar diye"
     * read as thirty thousand and two and a half. A fraction trailing a run that has
     * already been scaled belongs to the next phrase, not this one.
     */
    while (
      tokens.length > 1
      && FRACTION_WORDS.has(tokens[tokens.length - 1].as)
      && tokens.some((t) => SCALE_WORDS.has(t.as))
    ) {
      tokens = tokens.slice(0, -1);
    }

    const phrase = tokens.map((t) => t.as).join(' ');
    const value = spokenNumber(phrase);
    if (value != null) found.push({ heard: tokens.map((t) => t.w).join(' '), as: phrase, value });
  };
  for (const t of snapped) {
    if (t.num) run.push(t);
    else flush();
  }
  flush();
  return found;
}

/**
 * Every number word, one spelling each, for the transcriber's vocabulary hint.
 *
 * The transcriber is given a list of words to expect, and the list it was first given held
 * the trade terms but not a single numeral — so "pachas hazaar" came back as "Pishas Hazar"
 * and "chobis hazaar" as "Kaobis Haza". The names were being hinted and were coming back
 * right; the amounts were not being hinted and were coming back wrong.
 *
 * Deduplicated by value so the list stays short: one way of saying fifty is enough to bias
 * the model toward the shape of the word.
 */
export function numeralVocabulary(): string[] {
  const seen = new Set<number>();
  const words: string[] = [];
  for (const [word, value] of Object.entries(UNITS)) {
    if (/^[a-z]+$/.test(word) && !seen.has(value)) {
      seen.add(value);
      words.push(word);
    }
  }
  for (const [word] of SCALES) if (!words.includes(word)) words.push(word);
  for (const word of Object.keys(FRACTIONS)) if (!words.includes(word)) words.push(word);
  return words;
}
