/**
 * Answering a question about the book.
 *
 * The shop asks things it would otherwise have to go and look up — who still owes, how much
 * is out with the karigars, what size Fatema takes — and gets a sentence back rather than a
 * screen to read.
 *
 * Every answer here comes from a FIXED query written by hand. The model chooses which of
 * them to run and supplies the parameters; it never composes a query itself and never sees
 * the data. A model that could write its own query over this book could also be talked into
 * writing an update, and no phrasing of a question is worth that.
 *
 * Nothing in this file writes anything.
 */

import type { Customer, HisaabEntry, Karigar, KarigarJob, Order } from '@/lib/store';
import { upcomingOccasions, occasionWhen } from '@/lib/occasions';
import type { RankedName } from './phonetics';

export const QUERY_KINDS = [
  'total_receivable', 'who_owes', 'advance_held', 'total_payable', 'person_balance',
  'karigar_gold', 'pending_jobs', 'overdue_jobs', 'person_jobs',
  'person_detail', 'occasions', 'counts', 'summary',
] as const;

export type QueryKind = typeof QUERY_KINDS[number];

export interface BookData {
  customers: Customer[];
  karigars: Karigar[];
  hisaabEntries: HisaabEntry[];
  karigarJobs: KarigarJob[];
  orders: Order[];
}

export interface Answer {
  text: string;
  /** Where to look, when the shop wants more than the sentence. */
  goTo?: string;
}

/* Grouped, because that is what tells a speech engine to say "twenty thousand". */
const grouped = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 });
const money = (n: number) => `${grouped.format(Math.round(n * 100) / 100)} rupees`;
const grams = (n: number) =>
  `${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 3 }).format(Math.round(n * 1000) / 1000)} grams`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c" — a list a person would say rather than one a machine would print. */
function listOut(items: string[], limit = 5): string {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  const joined = shown.length > 1
    ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
    : shown[0] ?? '';
  return rest > 0 ? `${joined}, and ${plural(rest, 'other', 'others')}` : joined;
}

/* ── The figures, each from one hand-written pass over the ledger ──────────── */

interface Balance { id: string; name: string; cash: number; gold: number }

/**
 * One pass, both sides. cashDebit is what they owe the shop and cashCredit what the shop
 * owes them — the same convention the Hisaab page totals with, deliberately, so a spoken
 * answer and the screen can never disagree.
 */
function balances(data: BookData, kind: 'customer' | 'karigar'): Balance[] {
  const names = new Map<string, string>(
    kind === 'customer'
      ? data.customers.map((c) => [c.id, c.name])
      : data.karigars.map((k) => [k.id, k.name]),
  );
  const out = new Map<string, Balance>();
  for (const [id, name] of names) out.set(id, { id, name, cash: 0, gold: 0 });
  for (const e of data.hisaabEntries) {
    if (e.entityType !== kind) continue;
    const row = out.get(e.entityId);
    if (!row) continue; // a removed person; their history stays but is not reported on
    row.cash += (e.cashDebit || 0) - (e.cashCredit || 0);
    row.gold += (e.goldCreditGrams || 0) - (e.goldDebitGrams || 0);
  }
  return [...out.values()];
}

const openJobs = (data: BookData) =>
  data.karigarJobs.filter((j) => j.status !== 'completed');

/** Overdue is judged against the date promised, not the age of the job. */
function overdueJobs(data: BookData, today: Date) {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14).toISOString();
  return openJobs(data).filter((j) => j.assignedDate && j.assignedDate < cutoff);
}

export interface AnswerContext {
  data: BookData;
  /** The person the question was about, already pinned to a real row. */
  person?: RankedName | null;
  /** Which field of a record was asked for — "ring size", "phone". */
  field?: string | null;
  today?: Date;
}

/** Fields of a customer record that can be asked for out loud. */
const FIELD_LABEL: Record<string, { label: string; of: (c: Customer) => string | undefined }> = {
  ringSize: { label: 'ring size', of: (c) => c.ringSize },
  bangleSize: { label: 'bangle size', of: (c) => c.bangleSize },
  braceletSize: { label: 'bracelet size', of: (c) => c.braceletSize },
  chainLength: { label: 'chain length', of: (c) => c.chainLength },
  birthday: { label: 'birthday', of: (c) => c.birthday },
  anniversary: { label: 'anniversary', of: (c) => c.anniversary },
  phone: { label: 'number', of: (c) => c.phone },
  address: { label: 'address', of: (c) => c.address },
  preference: { label: 'preference', of: (c) => c.preference },
};

export const DETAIL_FIELDS = Object.keys(FIELD_LABEL);

export function answerQuestion(kind: string, ctx: AnswerContext): Answer {
  const { data, person, field } = ctx;
  const today = ctx.today ?? new Date();

  switch (kind as QueryKind) {
    case 'total_receivable': {
      const owing = balances(data, 'customer').filter((c) => c.cash > 0).sort((a, b) => b.cash - a.cash);
      if (!owing.length) return { text: 'Nothing is outstanding — every customer account is settled.' };
      const total = owing.reduce((a, c) => a + c.cash, 0);
      return {
        text: `${money(total)} still to collect, across ${plural(owing.length, 'account', 'accounts')}. `
          + `The largest is ${owing[0].name} at ${money(owing[0].cash)}.`,
        goTo: '/hisaab',
      };
    }

    case 'who_owes': {
      const owing = balances(data, 'customer').filter((c) => c.cash > 0).sort((a, b) => b.cash - a.cash);
      if (!owing.length) return { text: 'Nobody owes anything at the moment.' };
      return { text: `${listOut(owing.map((c) => `${c.name} ${money(c.cash)}`))}.`, goTo: '/hisaab' };
    }

    case 'advance_held': {
      const credit = balances(data, 'customer').filter((c) => c.cash < 0);
      if (!credit.length) return { text: 'You are not holding an advance for anybody.' };
      const total = credit.reduce((a, c) => a + Math.abs(c.cash), 0);
      return {
        text: `You are holding ${money(total)} that belongs to ${plural(credit.length, 'customer', 'customers')} — `
          + `${listOut(credit.map((c) => `${c.name} ${money(Math.abs(c.cash))}`))}.`,
      };
    }

    case 'total_payable': {
      const owed = balances(data, 'karigar').filter((k) => k.cash < 0).sort((a, b) => a.cash - b.cash);
      if (!owed.length) return { text: 'No labour is outstanding to any karigar.' };
      const total = owed.reduce((a, k) => a + Math.abs(k.cash), 0);
      return {
        text: `${money(total)} of labour owed, to ${plural(owed.length, 'karigar', 'karigars')} — `
          + `${listOut(owed.map((k) => `${k.name} ${money(Math.abs(k.cash))}`))}.`,
        goTo: '/karigars',
      };
    }

    case 'person_balance': {
      if (!person) return { text: 'Who did you want to check?' };
      const row = balances(data, person.kind).find((x) => x.id === person.id);
      const cash = row?.cash ?? 0;
      const gold = row?.gold ?? 0;
      if (person.kind === 'karigar') {
        const bits: string[] = [];
        if (cash === 0) bits.push('no labour outstanding');
        else if (cash < 0) bits.push(`${money(-cash)} of labour owed to him`);
        else bits.push(`${money(cash)} paid to him in advance`);
        if (gold > 0) bits.push(`${grams(gold)} of gold owed to him`);
        else if (gold < 0) bits.push(`${grams(-gold)} of gold owed back to you`);
        return { text: `${person.name}: ${bits.join(', and ')}.`, goTo: `/hisaab/${person.id}?type=karigar` };
      }
      return {
        text: cash > 0 ? `${person.name} owes ${money(cash)}.`
          : cash < 0 ? `You owe ${person.name} ${money(-cash)}.`
            : `${person.name} is settled — nothing outstanding either way.`,
        goTo: `/hisaab/${person.id}?type=customer`,
      };
    }

    case 'karigar_gold': {
      const rows = balances(data, 'karigar');
      if (person && person.kind === 'karigar') {
        const g = rows.find((x) => x.id === person.id)?.gold ?? 0;
        return {
          text: g > 0 ? `${grams(g)} of gold is owed to ${person.name}.`
            : g < 0 ? `${person.name} owes you ${grams(-g)} of gold.`
              : `${person.name}'s gold hisaab is square.`,
          goTo: `/hisaab/${person.id}?type=karigar`,
        };
      }
      const owed = rows.filter((k) => k.gold > 0).sort((a, b) => b.gold - a.gold);
      if (!owed.length) return { text: 'No gold is outstanding with any karigar.' };
      const total = owed.reduce((a, k) => a + k.gold, 0);
      return {
        text: `${grams(total)} of gold owed, across ${plural(owed.length, 'karigar', 'karigars')} — `
          + `${listOut(owed.map((k) => `${k.name} ${grams(k.gold)}`))}.`,
        goTo: '/karigars',
      };
    }

    case 'pending_jobs': {
      const jobs = openJobs(data);
      if (!jobs.length) return { text: 'Nothing is out with a karigar.' };
      const late = overdueJobs(data, today);
      const weight = jobs.reduce((a, j) => a + (j.weightG || 0), 0);
      return {
        text: `${plural(jobs.length, 'piece is', 'pieces are')} out with the karigars`
          + (weight ? `, ${grams(weight)} in all` : '')
          + (late.length ? `, and ${plural(late.length, 'is', 'are')} overdue.` : '.'),
        goTo: '/workshop',
      };
    }

    case 'overdue_jobs': {
      const late = overdueJobs(data, today);
      if (!late.length) return { text: 'Nothing is overdue — every piece is still within its date.' };
      return {
        text: `${plural(late.length, 'piece is', 'pieces are')} overdue: `
          + `${listOut(late.map((j) => `${j.description}${j.karigarName ? ` with ${j.karigarName}` : ''}`))}.`,
        goTo: '/workshop',
      };
    }

    case 'person_jobs': {
      if (!person) return { text: 'Whose work did you want?' };
      if (person.kind === 'karigar') {
        const rows = openJobs(data).filter((j) => j.karigarId === person.id);
        if (!rows.length) return { text: `Nothing is out with ${person.name}.` };
        return {
          text: `${plural(rows.length, 'piece', 'pieces')} out with ${person.name}: `
            + `${listOut(rows.map((j) => j.description))}.`,
          goTo: '/workshop',
        };
      }
      const theirs = data.orders.filter(
        (o) => o.customerId === person.id && o.status !== 'Completed' && o.status !== 'Cancelled',
      );
      if (!theirs.length) return { text: `Nothing is on order for ${person.name}.` };
      return {
        text: `${plural(theirs.length, 'order', 'orders')} for ${person.name}: `
          + `${listOut(theirs.map((o) => o.items.map((i) => i.description).join(', ') || o.id))}.`,
        goTo: `/customers/${person.id}`,
      };
    }

    case 'person_detail': {
      if (!person) return { text: 'Whose record did you want?' };
      if (person.kind !== 'customer') return { text: `${person.name} is a karigar — sizes are kept for customers.` };
      const c = data.customers.find((x) => x.id === person.id);
      if (!c) return { text: `${person.name} is not in the book any more.` };
      const spec = field ? FIELD_LABEL[field] : null;
      if (spec) {
        const v = spec.of(c);
        return {
          text: v ? `${person.name}'s ${spec.label} is ${v}.`
            : `No ${spec.label} on file for ${person.name}.`,
          goTo: `/customers/${person.id}`,
        };
      }
      // No particular field asked for — read out whatever is known.
      const known = Object.values(FIELD_LABEL)
        .map((f) => { const v = f.of(c); return v ? `${f.label} ${v}` : null; })
        .filter(Boolean) as string[];
      return {
        text: known.length ? `${person.name}: ${listOut(known, 6)}.` : `Nothing is on file for ${person.name} beyond the name.`,
        goTo: `/customers/${person.id}`,
      };
    }

    case 'occasions': {
      const soon = upcomingOccasions(data.customers, today);
      if (!soon.length) return { text: 'No birthdays or anniversaries in the next fortnight.' };
      return {
        text: `${listOut(soon.map((o) => `${o.customerName}'s ${o.kind} ${occasionWhen(o.inDays)}`))}.`,
        goTo: '/customers',
      };
    }

    case 'counts': {
      return {
        text: `${plural(data.customers.length, 'customer', 'customers')}, `
          + `${plural(data.karigars.length, 'karigar', 'karigars')}, `
          + `and ${plural(openJobs(data).length, 'piece', 'pieces')} out with the bench.`,
      };
    }

    case 'summary': {
      const owing = balances(data, 'customer').filter((c) => c.cash > 0);
      const payable = balances(data, 'karigar').filter((k) => k.cash < 0);
      const late = overdueJobs(data, today);
      const bits = [
        owing.length ? `${money(owing.reduce((a, c) => a + c.cash, 0))} to collect` : 'nothing to collect',
        payable.length ? `${money(payable.reduce((a, k) => a + Math.abs(k.cash), 0))} of labour owed` : null,
        `${plural(openJobs(data).length, 'piece', 'pieces')} on the bench`,
        late.length ? `${late.length} overdue` : null,
      ].filter(Boolean) as string[];
      return { text: `${bits.join(', ')}.`, goTo: '/' };
    }

    default:
      return { text: 'I can tell you what is owed, what is on the bench, or somebody\'s sizes. Which did you mean?' };
  }
}
