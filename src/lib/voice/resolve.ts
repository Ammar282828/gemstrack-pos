/**
 * What a spoken instruction means, and what it is allowed to do to the book.
 *
 * The model decides what it thinks it heard. This file is the judgement that sits between
 * that and anything actually being written down: it pins the name to a real row, refuses
 * to guess between two people who sound alike, and keeps a karigar off the customer side
 * of the book.
 *
 * That separation is worth keeping even with a single caller. The worst bug the shop
 * software ever had was a karigar's id written into a customer's ledger, moving money on
 * an unrelated account, silently. The rule that prevents it lives in exactly one place.
 *
 * Nothing here writes. It returns a *reading* — what it believes was meant, pinned to real
 * ids — which the app shows for confirmation before a single document is touched.
 */

import { matchShape, rankNames, type LearnedAlias, type PersonKind, type RankedName, type RosterEntry } from './phonetics';

export const VOICE_ACTIONS = [
  /* money against a person */
  'record_owed', 'record_we_owe', 'record_payment', 'record_payout', 'write_off',
  /* shop cash, nobody attached */
  'expense', 'other_income',
  /* the people themselves */
  'new_customer', 'new_karigar', 'edit_customer', 'edit_karigar',
  /* the gold hisaab, which is its own book */
  'gold_received', 'gold_paid',
  /* none of these write anything */
  'ask', 'query_balance', 'navigate', 'help', 'unknown',
  /* takes back the last entry rather than writing a new one */
  'undo',
] as const;

export type VoiceAction = typeof VOICE_ACTIONS[number];

/**
 * Screens you can ask for by name.
 *
 * Without this the shop can talk to the book but cannot move around it — every change of
 * screen still needs a thumb, which is the thing that stops voice being the way you use
 * the software rather than a shortcut bolted onto it.
 */
export const SCREENS: Record<string, string> = {
  dashboard: '/',
  home: '/',
  customers: '/customers',
  karigars: '/karigars',
  orders: '/orders',
  products: '/products',
  hisaab: '/hisaab',
  ledger: '/hisaab',
  cash: '/hisaab',
  expenses: '/expenses',
  analytics: '/analytics',
  calendar: '/calendar',
  settings: '/settings',
};

/**
 * What the model is allowed to set on a record.
 *
 * Whitelisted here rather than trusted from the reply, so a hallucinated field name cannot
 * reach a write, and so `deletedAt` can never be reached by talking. Removing someone
 * stays a deliberate act with a confirmation attached to it.
 */
export const CUSTOMER_FIELDS = [
  'name', 'phone', 'altPhone', 'email', 'city', 'address', 'country',
  'ringSize', 'bangleSize', 'braceletSize', 'chainLength',
  'birthday', 'anniversary', 'preference', 'notes',
] as const;

export const KARIGAR_FIELDS = [
  'name', 'contact', 'altPhone', 'specialty', 'workshop', 'address', 'city', 'country', 'notes',
] as const;

/** What the model is asked to produce. Every field is optional — it often knows only some. */
export interface RawIntent {
  action?: string;
  summary?: string;
  person?: { name?: string; spoken_as?: string; kind?: PersonKind };
  for_customer?: string;
  amount?: number | null;
  grams?: number | null;
  karat?: number | null;
  description?: string;
  screen?: string;
  query?: string;
  fields?: Record<string, unknown> | null;
  /** Set by us, not the model, when the figure had to be recovered from the summary. */
  amount_recovered?: boolean;
}

export interface ResolvedPerson {
  match: RankedName | null;
  candidates: RankedName[];
  ambiguous: boolean;
}

export interface Reading {
  action: VoiceAction;
  summary: string;
  /** The person this writes against, pinned to a real row. Null means nothing is pinned. */
  person: RankedName | null;
  /** Offered when the sound cannot separate two people — the shop picks. */
  candidates: RankedName[];
  ambiguous: boolean;
  /** A customer named as the recipient of an order, separately from who the order is with. */
  forCustomer: RankedName | null;
  forCustomerCandidates: RankedName[];
  amount: number | null;
  grams: number | null;
  karat: number | null;
  description: string;
  screen: string | null;
  query: string | null;
  fields: Record<string, string> | null;
  /** True when this reading is safe to write without asking anything further. */
  postable: boolean;
  /** Why it is not postable, in the shop's own words. */
  blockedBecause: string | null;
}

function cleanFields(
  raw: Record<string, unknown> | null | undefined,
  allowed: readonly string[],
): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!allowed.includes(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    out[k] = String(v).slice(0, 400);
  }
  return Object.keys(out).length ? out : null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * The model picks a name from the roster; this confirms it against the real records and,
 * when the model guessed loosely, falls back to sound-alike ranking. Nothing is trusted on
 * the model's word alone — every action ends up pinned to a real row id.
 */
export function resolvePerson(
  intent: RawIntent,
  list: RosterEntry[],
  aliases: Map<string, LearnedAlias>,
): ResolvedPerson {
  const spoken = intent?.person?.spoken_as || intent?.person?.name || '';
  const claimed = intent?.person?.name || '';
  const wantKind = intent?.person?.kind;
  if (!spoken && !claimed) return { match: null, candidates: [], ambiguous: false };

  /**
   * The kind the model states is a hint, not a filter.
   *
   * It chooses the name out of a roster that labels every row C or K, and it gets the name
   * right far more reliably than the label. "Altaf bhai ko paanch hazaar diye" came back as
   * exactly the right name marked "customer" — and filtering the pool on that label turned
   * the one perfect match in the book into no match at all, so the entry was never written.
   * The name decides; the kind only breaks a tie.
   *
   * Two people can share a first name — there is more than one Alifya in this book. If only
   * "Alifya" was said, the model will still name one of them in full, and taking its word
   * would silently post money to the wrong account. Whenever the sound of what was actually
   * SAID cannot separate the top two, hand the choice back rather than guessing.
   *
   * This is judged before the model's chosen name is honoured, and that order is the whole
   * point: the model completing "Alifya" to "Alifya Burhanuddin" is a guess wearing the
   * clothes of a certainty, and the heard name is the only evidence that can check it.
   */
  const judge = (pool: RosterEntry[]) => {
    const ranked = rankNames(spoken || claimed, pool, aliases);
    const top = ranked[0];
    const next = ranked[1];
    return {
      ranked,
      top,
      ambiguous: Boolean(top && next && top.score >= 0.7 && top.score - next.score < 0.1),
      /**
       * A high score is not enough on its own — the match also has to be more than a single
       * token of a longer name. "Altaf bhai" scores 0.875 against "Sheila Altaf" on the
       * surname alone, which is exactly the shape of a wrong answer that looks confident.
       */
      decisive: Boolean(
        top && top.score >= 0.82 && (!next || top.score - next.score >= 0.12)
        && !matchShape(spoken || claimed, top.name).thin,
      ),
    };
  };

  const preferred = wantKind === 'karigar' || wantKind === 'customer'
    ? list.filter((r) => r.kind === wantKind)
    : list;

  let r = preferred.length ? judge(preferred) : judge(list);
  // Nothing worth showing on the side the model expected — look at the whole book before
  // giving up, since the label is the part it gets wrong.
  if (!r.decisive && !r.ambiguous && !(r.top && r.top.score > 0.45) && preferred.length !== list.length) {
    r = judge(list);
  }

  const candidates = r.ranked.filter((x) => x.score > 0.45).slice(0, 5);

  /**
   * A name this shop has already corrected once beats everything else.
   *
   * It is the only signal here that is not a guess: somebody was asked "which Alifya?",
   * answered, and that answer was written down. The model completing a half-heard "Alifya"
   * to a full roster name is still just a guess, and it was winning — so teaching the
   * assistant a name changed nothing in exactly the case where teaching it mattered.
   */
  if (r.top?.via === 'learned') {
    return { match: r.top, candidates: [], ambiguous: false };
  }

  // What was heard cannot tell these people apart. Ask, whoever the model named.
  if (r.ambiguous) return { match: null, candidates, ambiguous: true };

  /* The model picked a name straight off the roster and the sound does not contradict it.
     Trust the name over the C|/K| label it attached — see above. */
  const exact = claimed ? list.filter((x) => x.name.toLowerCase() === claimed.toLowerCase()) : [];
  if (exact.length === 1) {
    return { match: { ...exact[0], score: 1, via: 'exact' as const }, candidates: [], ambiguous: false };
  }
  if (exact.length > 1) {
    // The same name on both sides of the book. The expected kind may separate them; if it
    // does not, that is a genuine question rather than a coin toss.
    const narrowed = exact.filter((x) => x.kind === wantKind);
    if (narrowed.length === 1) {
      return { match: { ...narrowed[0], score: 1, via: 'exact' as const }, candidates: [], ambiguous: false };
    }
    return {
      match: null,
      candidates: exact.slice(0, 5).map((x) => ({ ...x, score: 1, via: 'exact' as const })),
      ambiguous: true,
    };
  }

  return { match: r.decisive ? r.top : null, candidates, ambiguous: false };
}

/** Actions that must name a person before they can be written. */
const NEEDS_PERSON = new Set<VoiceAction>([
  'record_owed', 'record_we_owe', 'record_payment', 'record_payout', 'write_off',
  'edit_customer', 'edit_karigar', 'gold_received', 'gold_paid',
]);

/** Actions that must carry a rupee figure. */
const NEEDS_AMOUNT = new Set<VoiceAction>([
  'record_owed', 'record_we_owe', 'record_payment', 'record_payout', 'write_off',
  'expense', 'other_income',
]);

/** Actions that must carry a weight. */
const NEEDS_GRAMS = new Set<VoiceAction>(['gold_received', 'gold_paid']);

/** Actions that never write anything. */
export const READ_ONLY_ACTIONS = new Set<VoiceAction>(['ask', 'query_balance', 'navigate', 'help', 'unknown', 'undo']);

export interface ResolveOptions {
  roster: RosterEntry[];
  aliases?: Map<string, LearnedAlias>;
  /** The shop's usual purity for each direction, used when a weight arrives without one. */
  receiveKarat?: number;
  payKarat?: number;
}

/**
 * Everything that happens AFTER the model has decided what was meant.
 *
 * Turns a loose reply into something safe to write: the name pinned to a real row, the
 * figure recovered if it was left out of the field but stated in the summary, and a plain
 * reason attached whenever the answer is not yet safe to act on.
 */
export function resolveIntent(raw: RawIntent | null | undefined, opts: ResolveOptions): Reading {
  const { roster, aliases = new Map<string, LearnedAlias>() } = opts;
  const intent: RawIntent = raw && typeof raw === 'object' ? { ...raw } : { action: 'unknown' };

  let action = (VOICE_ACTIONS as readonly string[]).includes(intent.action ?? '')
    ? (intent.action as VoiceAction)
    : 'unknown';

  /* query_balance was the old name for asking about one person's account. */
  let query = intent.query ?? null;
  if (action === 'query_balance') {
    action = 'ask';
    query = query || 'person_balance';
  }

  /**
   * The model sometimes writes the figure into its summary and still leaves `amount` null.
   * Asking it not to did not reliably stop that, so recover the number rather than
   * presenting an empty box. Only a currency-marked figure counts, and the first one wins —
   * summaries put the outstanding amount first and any context after it.
   */
  let amount = num(intent.amount);
  if (amount == null && NEEDS_AMOUNT.has(action)) {
    const m = String(intent.summary ?? '').match(/(?:Rs\.?|₨|PKR)\s*([\d][\d,]*(?:\.\d+)?)/i);
    if (m) amount = num(m[1].replace(/,/g, ''));
  }

  /* Only fields the record actually has survive the trip out of the model. */
  const fields = cleanFields(
    intent.fields,
    action === 'new_karigar' || action === 'edit_karigar' ? KARIGAR_FIELDS : CUSTOMER_FIELDS,
  );

  /* A weight with no karat is the shop's usual purity for that direction, not a blank. */
  let karat = num(intent.karat);
  if (action === 'gold_received' && karat == null) karat = opts.receiveKarat ?? 21;
  if (action === 'gold_paid' && karat == null) karat = opts.payKarat ?? 24;

  const { match, candidates, ambiguous } = resolvePerson(intent, roster, aliases);

  /* "ring for Fatema Marvi" should attach the order to her record, not just mention her. */
  let forCustomer: RankedName | null = null;
  let forCustomerCandidates: RankedName[] = [];
  if (intent.for_customer) {
    const onlyCustomers = roster.filter((r) => r.kind === 'customer');
    const ranked = rankNames(intent.for_customer, onlyCustomers, aliases);
    const exact = onlyCustomers.find(
      (r) => r.name.toLowerCase() === String(intent.for_customer).toLowerCase(),
    );
    if (exact) forCustomer = { ...exact, score: 1, via: 'exact' };
    else if (ranked[0]?.score >= 0.82 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.12)) {
      forCustomer = ranked[0];
    } else {
      /**
       * Named but not pinned, which is the case that used to disappear.
       *
       * The order was written anyway, with no customer on it and nothing said so. A name
       * heard badly enough to miss the threshold — "Zahra Isbag" for Zahra Iceberg, at
       * 0.63 — has to become a question, and a question needs the names to choose between.
       */
      forCustomerCandidates = ranked.filter((r) => r.score >= 0.4).slice(0, 5);
    }
  }

  const grams = num(intent.grams);

  /* What still stands between this reading and being written down. */
  let blockedBecause: string | null = null;
  if (action === 'unknown') blockedBecause = 'Not sure what that meant.';
  else if (ambiguous) blockedBecause = 'More than one person sounds like that.';
  else if (NEEDS_PERSON.has(action) && !match) blockedBecause = 'No name matched anyone in the book.';
  else if (NEEDS_AMOUNT.has(action) && (amount == null || amount <= 0)) blockedBecause = 'No amount.';
  else if (NEEDS_GRAMS.has(action) && (grams == null || grams <= 0)) blockedBecause = 'No weight.';
  else if ((action === 'new_customer' || action === 'new_karigar') && !fields?.name) blockedBecause = 'No name given.';
  else if (action === 'edit_customer' || action === 'edit_karigar') {
    if (!fields) blockedBecause = 'Nothing to change.';
  }

  return {
    action,
    summary: String(intent.summary ?? '').slice(0, 500),
    person: match,
    candidates,
    ambiguous,
    forCustomer,
    forCustomerCandidates,
    amount,
    grams,
    karat,
    description: String(intent.description ?? '').slice(0, 300),
    screen: action === 'navigate' ? (SCREENS[String(intent.screen ?? '').toLowerCase()] ?? null) : null,
    query,
    fields,
    postable: !READ_ONLY_ACTIONS.has(action) && blockedBecause === null,
    blockedBecause,
  };
}
