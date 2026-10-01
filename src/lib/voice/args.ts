/**
 * What a spoken value means, for the commands (commands.ts): "Rashida" to a customer, "order
 * forty one" to ORD-000041, "R 123" to a piece in stock, "kal" to a date, "21k" to a karat.
 *
 * The same rule as the khata (resolve.ts): nothing is guessed between two rows. A name that
 * could be two people, a customer with two open orders, a description that fits three pieces —
 * each comes back as candidates for the card to ask about. Pure: the book is handed in.
 */

import type {
  AdditionalRevenue, Customer, Expense, GivenItem, Invoice, Karigar, KarigarJob, Order, Product, Repair,
} from '@/lib/store';
import { rankNames, matchShape, type LearnedAlias, type RankedName, type RosterEntry } from './phonetics';
import { isWalkInName } from '@/lib/walk-in';

export type ArgType =
  | 'customer' | 'karigar' | 'person'
  | 'order' | 'invoice' | 'repair' | 'product' | 'given' | 'job' | 'expense' | 'income'
  | 'money' | 'number' | 'grams' | 'karat' | 'text' | 'date' | 'enum' | 'bool' | 'screen' | 'phone';

export interface ArgSpec {
  name: string;
  type: ArgType;
  /** What the card calls it. */
  label: string;
  required?: boolean;
  /** For enum: the values, as the card shows them. */
  options?: readonly string[];
  /** For enum: other words for an option ("ready" -> "Ready"). */
  synonyms?: Record<string, string>;
  /** For an order or invoice that will be written to: only open ones. */
  open?: boolean;
}

export interface Choice { key: string; label: string; detail?: string; value: unknown }

export type Resolved =
  | { ok: true; value: unknown; label: string; ref?: number }
  | { ok: false; reason: string; candidates: Choice[] };

export interface Destination { label: string; href: string; keywords: string[] }

export interface Book {
  roster: RosterEntry[];
  aliases: Map<string, LearnedAlias>;
  customers: Customer[];
  karigars: Karigar[];
  orders: Order[];
  invoices: Invoice[];
  repairs: Repair[];
  products: Product[];
  givenItems: GivenItem[];
  karigarJobs: KarigarJob[];
  expenses: Expense[];
  extraRevenues: AdditionalRevenue[];
  destinations: Destination[];
  /** yyyy-mm-dd, Karachi. */
  today: string;
}

const lc = (s: unknown) => String(s ?? '').toLowerCase().trim();
const words = (s: unknown) => lc(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
const fail = (reason: string, candidates: Choice[] = []): Resolved => ({ ok: false, reason, candidates });
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;

/** "1,50,000", "Rs 34000", "34k", "dhai lakh" (as digits by now) -> a number. */
export function parseNumber(v: string): number | null {
  const s = lc(v).replace(/rs\.?|pkr|₨|grams?|gm?\b|tola/g, '').replace(/,/g, '').trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(k|thousand|hazaar|hazar|lakh|lac|crore)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = { k: 1e3, thousand: 1e3, hazaar: 1e3, hazar: 1e3, lakh: 1e5, lac: 1e5, crore: 1e7 }[m[2] as 'k'] ?? 1;
  return Number.isFinite(n) ? n * mult : null;
}

/** "aaj", "kal", "parso", "2026-10-05", "5 Oct" -> yyyy-mm-dd. "kal" is tomorrow: a promise looks ahead. */
export function parseDate(v: string, today: string): string | null {
  const s = lc(v);
  const base = new Date(`${today}T12:00:00Z`);
  const plus = (d: number) => new Date(base.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^(aaj|today)$/.test(s)) return today;
  if (/^(kal|tomorrow)$/.test(s)) return plus(1);
  if (/^(parso|parson|day after tomorrow)$/.test(s)) return plus(2);
  const inDays = s.match(/^(?:in\s+)?(\d+)\s*(?:din|days?)(?:\s*(?:mein|baad|later))?$/);
  if (inDays) return plus(Number(inDays[1]));
  const t = Date.parse(`${v} ${base.getUTCFullYear()}`);
  if (Number.isFinite(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

/** "21k", "21 karat", "21" -> "21k". */
export function parseKarat(v: string): string | null {
  const m = lc(v).match(/(\d{2})/);
  return m && ['12', '18', '21', '22', '24'].includes(m[1]) ? `${m[1]}k` : null;
}

function matchEnum(spec: ArgSpec, v: string): string | null {
  const s = lc(v);
  const opts = spec.options ?? [];
  const hit = opts.find(o => lc(o) === s)
    ?? Object.entries(spec.synonyms ?? {}).find(([k]) => s.includes(lc(k)))?.[1]
    ?? opts.find(o => lc(o).startsWith(s) || s.startsWith(lc(o)))
    ?? opts.find(o => s.includes(lc(o)));
  return hit ?? null;
}

// ── People ───────────────────────────────────────────────────────────────────

function person(v: string, book: Book, kind: 'customer' | 'karigar' | 'person'): Resolved {
  const pool = kind === 'person' ? book.roster : book.roster.filter(r => r.kind === kind);
  const exact = pool.filter(r => lc(r.name) === lc(v));
  if (exact.length === 1) return { ok: true, value: { ...exact[0], score: 1, via: 'exact' }, label: exact[0].name };
  const ranked = rankNames(v, pool, book.aliases);
  const top = ranked[0], next = ranked[1];
  if (top?.via === 'learned') return { ok: true, value: top, label: top.name };
  const decisive = top && top.score >= 0.82 && (!next || top.score - next.score >= 0.12) && !matchShape(v, top.name).thin;
  if (decisive) return { ok: true, value: top, label: top.name };
  const candidates = (exact.length > 1 ? exact.map(r => ({ ...r, score: 1, via: 'exact' as const })) : ranked.filter(r => r.score > 0.45))
    .slice(0, 6).map(r => ({ key: `${r.kind}:${r.id}`, label: r.name, detail: r.kind === 'customer' ? 'Customer' : 'Karigar', value: r }));
  return fail(candidates.length ? `Which ${kind === 'person' ? 'one' : kind}?` : `No ${kind === 'person' ? 'one' : kind} called "${v}" in the book.`, candidates);
}

/** The one customer a value names, for finding their orders, bills and repairs. */
function customerOf(v: string, book: Book): RankedName | null {
  const r = person(v, book, 'customer');
  return r.ok ? (r.value as RankedName) : null;
}

// ── Papers: orders, invoices, repairs ────────────────────────────────────────

const docId = (prefix: string, v: string) => {
  const d = v.replace(/\D+/g, '');
  return d ? `${prefix}-${String(parseInt(d, 10)).padStart(6, '0')}` : null;
};

const orderOpen = (o: Order) => (o.status === 'Pending' || o.status === 'In Progress' || o.status === 'Completed') && !o.invoiceId;
const orderChoice = (o: Order): Choice => ({
  key: o.id, label: o.id, value: o,
  detail: [o.customerName || 'Walk-in', `${(o.items ?? []).length} piece${(o.items ?? []).length === 1 ? '' : 's'}`, o.invoiceId ? `invoiced ${o.invoiceId}` : o.status].join(' · '),
});
const invoiceChoice = (i: Invoice): Choice => ({
  key: i.id, label: i.id, value: i,
  detail: [i.customerName || 'Walk-in', i.status === 'Refunded' ? 'refunded' : Number(i.balanceDue) > 0 ? `${rs(i.balanceDue)} due` : 'paid'].join(' · '),
});
const repairChoice = (r: Repair): Choice => ({
  key: r.id, label: r.id, value: r,
  detail: [r.customerName || 'Walk-in', (r.pieces ?? []).map(p => p.item).filter(Boolean).join(', '), r.status].filter(Boolean).join(' · '),
});

function paper<T extends { id: string; customerId?: string; customerName?: string; createdAt?: string; receivedAt?: string }>(
  v: string, list: T[], prefix: string, noun: string, isOpen: (x: T) => boolean, choice: (x: T) => Choice, book: Book, wantOpen: boolean,
): Resolved {
  if (/\d/.test(v)) {
    const id = docId(prefix, v);
    const hit = list.find(x => x.id === id);
    if (!hit) return fail(`${id} is not in the book.`);
    if (wantOpen && !isOpen(hit)) return fail(`${id} is closed.`, [choice(hit)]);
    return { ok: true, value: hit, label: hit.id };
  }
  if (/^(last|latest|newest|abhi wala|this)$/i.test(v.trim())) {
    const latest = [...list].sort((a, b) => String(b.createdAt ?? b.receivedAt).localeCompare(String(a.createdAt ?? a.receivedAt)))[0];
    return latest ? { ok: true, value: latest, label: latest.id } : fail(`No ${noun} in the book.`);
  }
  const c = customerOf(v, book);
  if (!c) {
    // The name could be several people: offer their papers, not the people.
    const who = person(v, book, 'customer');
    const people = who.ok ? [] : who.candidates.map(x => x.value as RankedName);
    const theirs = list.filter(x => people.some(p => x.customerId === p.id || lc(x.customerName) === lc(p.name)));
    const pool = (wantOpen ? theirs.filter(isOpen) : theirs).slice(0, 6);
    // Only one paper among everyone the name could be: that is the one (the card names whose).
    if (pool.length === 1) return { ok: true, value: pool[0], label: pool[0].id };
    return fail(pool.length ? `Which ${noun}?` : `No ${noun} for "${v}".`, pool.map(choice));
  }
  const theirs = list.filter(x => x.customerId === c.id || lc(x.customerName) === lc(c.name));
  const open = theirs.filter(isOpen);
  const pool = wantOpen ? open : open.length ? open : theirs;
  if (pool.length === 1) return { ok: true, value: pool[0], label: pool[0].id };
  if (pool.length > 1) return fail(`${c.name} has more than one ${noun}.`, pool.slice(0, 6).map(choice));
  return fail(theirs.length ? `${c.name} has no open ${noun}.` : `${c.name} has no ${noun} in the book.`);
}

// ── Stock and the rest ───────────────────────────────────────────────────────

const productChoice = (p: Product): Choice => ({ key: p.sku, label: p.sku, detail: [p.name, p.metalWeightG ? `${p.metalWeightG} g` : '', p.karat].filter(Boolean).join(' · '), value: p });

function product(v: string, book: Book): Resolved {
  const s = v.toUpperCase().replace(/\s+/g, '');
  const exact = book.products.find(p => p.sku.toUpperCase().replace(/\s+/g, '') === s);
  if (exact) return { ok: true, value: exact, label: exact.sku };
  const digits = v.replace(/\D+/g, '');
  if (digits) {
    const n = parseInt(digits, 10);
    const byNumber = book.products.filter(p => parseInt(p.sku.replace(/\D+/g, ''), 10) === n);
    if (byNumber.length === 1) return { ok: true, value: byNumber[0], label: byNumber[0].sku };
    if (byNumber.length > 1) return fail('Which piece?', byNumber.slice(0, 6).map(productChoice));
  }
  const w = words(v);
  const scored = book.products.map(p => ({ p, hit: w.filter(x => lc(`${p.name} ${p.description ?? ''} ${p.sku}`).includes(x)).length }))
    .filter(x => x.hit > 0).sort((a, b) => b.hit - a.hit);
  if (scored.length === 1 || (scored.length > 1 && scored[0].hit > scored[1].hit && scored[0].hit === w.length)) return { ok: true, value: scored[0].p, label: scored[0].p.sku };
  return fail(scored.length ? 'Which piece?' : `No piece "${v}" in stock.`, scored.slice(0, 6).map(x => productChoice(x.p)));
}

/** A row found by its words: a given item, a workshop job, an expense, an income line. */
function byWords<T>(v: string, list: T[], text: (x: T) => string, when: (x: T) => string, choice: (x: T) => Choice, noun: string): Resolved {
  const sorted = [...list].sort((a, b) => when(b).localeCompare(when(a)));
  if (/^(last|latest|newest|abhi wala|this|that)$/i.test(v.trim())) {
    return sorted[0] ? { ok: true, value: sorted[0], label: choice(sorted[0]).label } : fail(`No ${noun} in the book.`);
  }
  const w = words(v);
  const scored = sorted.map(x => ({ x, hit: w.filter(t => lc(text(x)).includes(t)).length })).filter(s => s.hit > 0).sort((a, b) => b.hit - a.hit);
  if (scored.length === 1 || (scored.length > 1 && scored[0].hit > scored[1].hit)) return { ok: true, value: scored[0].x, label: choice(scored[0].x).label };
  return fail(scored.length ? `Which ${noun}?` : `No ${noun} matching "${v}".`, scored.slice(0, 6).map(s => choice(s.x)));
}

function screen(v: string, book: Book): Resolved {
  const s = lc(v);
  const exact = book.destinations.find(d => lc(d.label) === s || d.keywords.some(k => lc(k) === s));
  if (exact) return { ok: true, value: exact.href, label: exact.label };
  const w = words(v);
  const scored = book.destinations.map(d => ({ d, hit: w.filter(t => lc(`${d.label} ${d.keywords.join(' ')}`).includes(t)).length }))
    .filter(x => x.hit > 0).sort((a, b) => b.hit - a.hit);
  if (scored.length && (scored.length === 1 || scored[0].hit > scored[1].hit)) return { ok: true, value: scored[0].d.href, label: scored[0].d.label };
  return fail(scored.length ? 'Which screen?' : `No screen called "${v}".`, scored.slice(0, 6).map(x => ({ key: x.d.href, label: x.d.label, value: x.d.href })));
}

/** One value. Null when nothing was said for it. A "$2" names what step 2 made or found. */
export function resolveArg(spec: ArgSpec, raw: string | undefined | null, book: Book): Resolved | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const ref = v.match(/^\$(\d+)$/);
  if (ref) return { ok: true, value: null, label: `the one from step ${ref[1]}`, ref: Number(ref[1]) };
  switch (spec.type) {
    case 'customer': case 'karigar': case 'person':
      return isWalkInName(v) && spec.type !== 'karigar' ? { ok: true, value: null, label: 'Walk-in' } : person(v, book, spec.type);
    case 'order':
      return paper(v, book.orders, 'ORD', 'order', orderOpen, orderChoice, book, !!spec.open);
    case 'invoice':
      return paper(v, book.invoices, 'INV', 'invoice', i => Number(i.balanceDue) > 0 && i.status !== 'Refunded', invoiceChoice, book, !!spec.open);
    case 'repair':
      return paper(v, book.repairs, 'REP', 'repair', r => r.status === 'received' || r.status === 'ready', repairChoice, book, !!spec.open);
    case 'product':
      return product(v, book);
    case 'given':
      return byWords(v, book.givenItems.filter(g => g.status === 'out'), g => `${g.description} ${g.recipientName}`, g => g.date,
        g => ({ key: g.id, label: g.description, detail: `${g.recipientName} · ${String(g.date).slice(0, 10)}`, value: g }), 'item given out');
    case 'job':
      return byWords(v, book.karigarJobs.filter(j => j.status !== 'completed'), j => `${j.description} ${j.karigarName}`, j => j.assignedDate,
        j => ({ key: j.id, label: j.description, detail: `${j.karigarName} · ${j.status}`, value: j }), 'workshop job');
    case 'expense':
      return byWords(v, book.expenses, e => `${e.description} ${e.category} ${e.amount}`, e => e.date,
        e => ({ key: e.id, label: e.description || e.category, detail: `${rs(e.amount)} · ${String(e.date).slice(0, 10)}`, value: e }), 'expense');
    case 'income':
      return byWords(v, book.extraRevenues, e => `${e.description} ${e.amount}`, e => e.date,
        e => ({ key: e.id, label: e.description, detail: `${rs(e.amount)} · ${String(e.date).slice(0, 10)}`, value: e }), 'income');
    case 'money': case 'number': case 'grams': {
      const n = parseNumber(v);
      return n == null ? fail(`"${v}" is not a number.`) : { ok: true, value: n, label: spec.type === 'money' ? rs(n) : spec.type === 'grams' ? `${n} g` : String(n) };
    }
    case 'karat': {
      const k = parseKarat(v);
      return k ? { ok: true, value: k, label: k } : fail(`"${v}" is not a karat.`);
    }
    case 'date': {
      const d = parseDate(v, book.today);
      return d ? { ok: true, value: d, label: d } : fail(`"${v}" is not a date.`);
    }
    case 'enum': {
      const e = matchEnum(spec, v);
      return e ? { ok: true, value: e, label: e } : fail(`"${v}" is not one of: ${(spec.options ?? []).join(', ')}.`, (spec.options ?? []).map(o => ({ key: o, label: o, value: o })));
    }
    case 'bool':
      return /^(on|yes|true|haan|chalu|start|enable)/i.test(v) ? { ok: true, value: true, label: 'On' }
        : /^(off|no|false|nahi|band|stop|disable)/i.test(v) ? { ok: true, value: false, label: 'Off' } : fail(`On or off?`);
    case 'screen':
      return screen(v, book);
    case 'phone': {
      const d = v.replace(/[^\d+]/g, '');
      return d.replace(/\D/g, '').length >= 7 ? { ok: true, value: d, label: d } : fail(`"${v}" is not a phone number.`);
    }
    case 'text':
    default:
      return { ok: true, value: v, label: v };
  }
}

/** A choice from the card, as a resolved value. */
export const chosen = (c: Choice): Resolved => ({ ok: true, value: c.value, label: c.label });
