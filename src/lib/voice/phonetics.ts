/**
 * Name matching for the names this shop actually keeps — Gujarati, Urdu and Arabic-origin
 * names written in Latin letters, where the same person is spelled a dozen ways.
 *
 * Soundex and Metaphone are built around English spelling and are close to useless here:
 * they treat Fatema/Fathima and Batul/Batool as unrelated. This collapses the specific
 * variations that actually occur in transliteration.
 */

export type PersonKind = 'customer' | 'karigar';

export interface RosterEntry {
  id: string;
  name: string;
  kind: PersonKind;
  phone?: string;
}

export interface RankedName extends RosterEntry {
  score: number;
  /**
   * How this row was reached. 'exact' is the model naming a roster row verbatim, 'learned'
   * is a correction the shop has already made once, 'phonetic' is a sound-alike guess.
   * Worth carrying: the UI confirms a phonetic match differently from a learned one.
   */
  via: 'learned' | 'phonetic' | 'exact';
}

export interface LearnedAlias {
  kind: PersonKind;
  id: string;
}

/** Sound-alike pairs that genuinely occur when these names are written in Latin script. */
function tokenKey(word: string): string {
  let s = word;

  // Aspirated consonants lose the h — Khan/Kan, Ghulam/Gulam, Bhai/Bai
  s = s.replace(/ph/g, 'f');
  s = s.replace(/([kgbdtjcs])h/g, '$1');

  // Spelling variants for the same sound
  s = s.replace(/ck/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks');
  s = s.replace(/w/g, 'v'); // Wala/Vala, Anwar/Anvar
  s = s.replace(/z/g, 'j'); // Zainab/Jainab — z is commonly voiced as j in Gujarati
  s = s.replace(/y/g, 'i');

  // Long vowels are written doubled or singly at random — Batool/Batul, Sakeena/Sakina
  s = s.replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/oo/g, 'u');
  s = s.replace(/ai/g, 'e').replace(/au/g, 'o').replace(/ou/g, 'u');

  s = s.replace(/(.)\1+/g, '$1'); // Abbas/Abas, Shabbir/Shabir
  s = s.replace(/h$/, ''); // Fatemah/Fatema
  s = s.replace(/[ae]$/, 'a'); // Fateme/Fatema
  return s;
}

/**
 * The same names, written in the scripts they are also spoken in.
 *
 * The roster is stored in Latin letters, but speech recognition returns Urdu or Gujarati
 * script when the sentence is spoken wholly in one of those — and stripping everything
 * outside a-z left an EMPTY key, so those names scored zero against every row in the book.
 * Not a poor match: no match, ever, silently.
 *
 * This is deliberately rough. It only has to get close enough for the sound rules below to
 * do their work, and those already forgive far bigger differences than a transliteration
 * choice between "v" and "w".
 */
const SCRIPTS = new Map<string, string>(
  /* "<letter>:<latin>", as plain strings — a combining vowel mark is not a valid object key. */
  (
    [
      /* Urdu and Arabic */
      'ا:a آ:a أ:a إ:a ب:b پ:p ت:t ٹ:t ث:s ج:j چ:ch ح:h خ:kh د:d ڈ:d ذ:z ر:r ڑ:r ز:z ژ:zh س:s ش:sh ص:s ض:z ط:t ظ:z ع:a غ:gh ف:f ق:k ک:k ك:k گ:g ل:l م:m ن:n ں:n و:o ہ:h ه:h ھ:h ی:i ي:i ے:e',
      /* Gujarati */
      'અ:a આ:a ઇ:i ઈ:i ઉ:u ઊ:u એ:e ઐ:ai ઓ:o ઔ:au ક:k ખ:kh ગ:g ઘ:gh ચ:ch છ:ch જ:j ઝ:jh ટ:t ઠ:th ડ:d ઢ:dh ણ:n ત:t થ:th દ:d ધ:dh ન:n પ:p ફ:f બ:b ભ:bh મ:m ય:y ર:r લ:l ળ:l વ:v શ:sh ષ:sh સ:s હ:h ા:a િ:i ી:i ુ:u ૂ:u ે:e ૈ:ai ો:o ૌ:au ્: ં:n',
      /* Devanagari, for the same names typed in Hindi */
      'अ:a आ:a इ:i ई:i उ:u ऊ:u ए:e ऐ:ai ओ:o औ:au क:k ख:kh ग:g घ:gh च:ch छ:ch ज:j झ:jh ट:t ठ:th ड:d ढ:dh ण:n त:t थ:th द:d ध:dh न:n प:p फ:f ब:b भ:bh म:m य:y र:r ल:l व:v श:sh ष:sh स:s ह:h ा:a ि:i ी:i ु:u ू:u े:e ै:ai ो:o ौ:au ्: ं:n',
    ]
      .join(' ')
      .split(' ')
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf(':');
        return [pair.slice(0, at), pair.slice(at + 1)] as [string, string];
      })
  ),
);

const transliterate = (s: string) => s.replace(/[^ -ɏ]/gu, (ch) => SCRIPTS.get(ch) ?? ' ');

export function phoneticKey(name: string | null | undefined): string[] {
  const base = transliterate(String(name ?? ''))
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ');
  return base.split(/\s+/).filter(Boolean).map(tokenKey).filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      cur[j + 1] = Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + (a[i] === b[j] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const ratio = (a: string, b: string) =>
  !a.length && !b.length ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length);

/**
 * Compare two names token by token. A spoken name is often only part of the stored one
 * ("Fatema" for "Fatema Bakir Abuwala"), so every query token must find a home but
 * unmatched stored tokens are only lightly penalised.
 */
export function nameScore(query: string, candidate: string): number {
  const q = phoneticKey(query);
  const c = phoneticKey(candidate);
  if (!q.length || !c.length) return 0;

  /**
   * Every spoken word counts, including one that finds no home.
   *
   * The shop says a name exactly as it is written in the book — no "aunty" or "bhai" unless
   * that is genuinely part of the stored name. So a word with nowhere to go is not noise to
   * be forgiven; it is evidence that this is the wrong person, and it should pull the score
   * down. Forgiving it turned "Altaf bhai" into a confident match on "Sheila Altaf", who is
   * the only Altaf in the book and not the man being spoken about.
   */
  const pool = [...c];
  let total = 0;
  for (const qt of q) {
    let best = 0;
    let bestAt = -1;
    pool.forEach((ct, i) => {
      const r = ratio(qt, ct);
      if (r > best) {
        best = r;
        bestAt = i;
      }
    });
    if (bestAt >= 0 && best > 0.5) pool.splice(bestAt, 1);
    total += best;
  }
  const covered = total / q.length;
  // Matching one token of a three-token name is weaker evidence than matching all of them.
  const completeness = 1 - (pool.length / c.length) * 0.25;
  return Math.max(0, Math.min(1, covered * completeness));
}

export interface MatchShape {
  matched: number;
  storedTokens: number;
  storedLeftOver: number;
  thin: boolean;
}

/**
 * How much of the name was actually heard, as opposed to how well it scored.
 *
 * "Altaf bhai" against "Sheila Altaf" scores 0.875 — one token out of two, with the title
 * set aside — which is high enough to act on without asking. But the only evidence is a
 * surname, and the one Altaf in the book is a woman called Sheila. Score alone cannot tell
 * that apart from a real match; the SHAPE of the match can.
 *
 * A match is thin when a single token carried it and the stored name has more to it. Thin
 * matches still rank and are still offered — they just have to be confirmed rather than
 * assumed.
 */
export function matchShape(query: string, candidate: string): MatchShape {
  const q = phoneticKey(query);
  const c = phoneticKey(candidate);
  const pool = [...c];
  let matched = 0;
  for (const qt of q) {
    let best = 0;
    let bestAt = -1;
    pool.forEach((ct, i) => {
      const r = ratio(qt, ct);
      if (r > best) {
        best = r;
        bestAt = i;
      }
    });
    if (bestAt >= 0 && best > 0.5) {
      pool.splice(bestAt, 1);
      matched++;
    }
  }
  return {
    matched,
    storedTokens: c.length,
    storedLeftOver: pool.length,
    thin: matched <= 1 && pool.length > 0,
  };
}

/** Rank a roster against a spoken name. Aliases already learned count as exact. */
export function rankNames(
  query: string,
  roster: RosterEntry[],
  aliases: Map<string, LearnedAlias> = new Map(),
): RankedName[] {
  const spoken = phoneticKey(query).join(' ');
  return roster
    .map((r): RankedName => {
      const learned = aliases.get(spoken);
      if (learned && learned.kind === r.kind && learned.id === r.id) {
        return { ...r, score: 1, via: 'learned' };
      }
      return { ...r, score: nameScore(query, r.name), via: 'phonetic' };
    })
    .sort((a, b) => b.score - a.score);
}
