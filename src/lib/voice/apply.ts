/**
 * Turning a confirmed reading into entries in the book.
 *
 * Every write here goes through the ordinary store actions rather than touching Firestore
 * directly, so a spoken entry lands with the same validation, the same activity log and
 * the same permissions as one typed into a form. Voice is a faster way to reach the same
 * door, never a second door.
 *
 * Nothing in this file decides anything. If a reading arrives that is not postable it is
 * refused outright — the judgement lives in resolveIntent(), and duplicating any of it
 * here is how the two would drift apart.
 */

import type { AppState, HisaabEntityType } from '@/lib/store';
import type { Reading } from './resolve';

export interface AppliedEntry {
  /** What to tell the shop, in one line. */
  said: string;
  /** Where to look at what was just written. */
  href?: string;
  /**
   * Take it back.
   *
   * Only the entry this call created — never a cascade. "Undo" said out loud a minute
   * later must mean the one thing that was just written, not everything since.
   * Undefined when the action created nothing that can be reversed by itself.
   */
  undo?: () => Promise<void>;
}

type Store = Pick<
  AppState,
  'addHisaabEntry' | 'addExpense' | 'addAdditionalRevenue'
  | 'addCustomer' | 'addKarigar' | 'updateCustomer' | 'updateKarigar'
  | 'deleteHisaabEntry' | 'deleteExpense' | 'deleteAdditionalRevenue'
  | 'deleteCustomer' | 'deleteKarigar'
>;

const money = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/**
 * Which column a rupee figure belongs in.
 *
 * cashDebit is what they owe the shop; cashCredit is what the shop owes them. Getting this
 * backwards is silent — the entry saves, the total is wrong, and nobody notices until a
 * customer disputes a balance — so the mapping is written out once, here, rather than
 * inferred at each call site.
 */
function ledgerColumns(reading: Reading): { cashDebit: number; cashCredit: number; goldDebitGrams: number; goldCreditGrams: number } {
  const amount = reading.amount ?? 0;
  const grams = reading.grams ?? 0;
  const zero = { cashDebit: 0, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0 };

  switch (reading.action) {
    /* They now owe the shop more — a piece sold on credit, a balance left after a part-payment. */
    case 'record_owed':   return { ...zero, cashDebit: amount };
    /* The shop paid a karigar his majoori: it reduces what the shop owes him. */
    case 'record_payout': return { ...zero, cashDebit: amount };
    /* They paid the shop: it reduces what they owe. */
    case 'record_payment': return { ...zero, cashCredit: amount };
    /* The shop now owes them more. */
    case 'record_we_owe': return { ...zero, cashCredit: amount };
    /* Forgiving a balance cancels what they owe without any money moving. */
    case 'write_off':     return { ...zero, cashCredit: amount };
    /* Metal the craftsman handed over. */
    case 'gold_received': return { ...zero, goldCreditGrams: grams };
    /* Metal the shop handed out. */
    case 'gold_paid':     return { ...zero, goldDebitGrams: grams };
    default:              return zero;
  }
}

/**
 * Write a confirmed reading.
 *
 * Throws rather than returning a failure for anything that should have been caught before
 * the shop was ever shown a confirmation — reaching here with an unpostable reading is a
 * bug in the caller, not a thing the counter should be asked about.
 */
export async function applyReading(reading: Reading, store: Store): Promise<AppliedEntry> {
  if (!reading.postable) {
    throw new Error(reading.blockedBecause ?? 'That is not ready to be written.');
  }

  const date = new Date().toISOString();

  switch (reading.action) {
    case 'record_owed':
    case 'record_we_owe':
    case 'record_payment':
    case 'record_payout':
    case 'write_off':
    case 'gold_received':
    case 'gold_paid': {
      const person = reading.person;
      if (!person) throw new Error('No name matched anyone in the book.');
      const columns = ledgerColumns(reading);
      const written = await store.addHisaabEntry({
        entityId: person.id,
        entityType: person.kind as HisaabEntityType,
        entityName: person.name,
        date,
        description: reading.description || reading.summary || 'Spoken entry',
        ...columns,
      });
      const figure = reading.grams != null && reading.grams > 0
        ? `${reading.grams} g${reading.karat ? ` @ ${reading.karat}k` : ''}`
        : money(reading.amount ?? 0);
      return {
        said: `Done — ${person.name}, ${figure}.`,
        href: `/hisaab/${person.id}?type=${person.kind}`,
        undo: written ? () => store.deleteHisaabEntry(written.id) : undefined,
      };
    }

    case 'expense': {
      const written = await store.addExpense({
        date,
        category: 'Other',
        description: reading.description || reading.summary || 'Spoken expense',
        amount: reading.amount ?? 0,
        paidBy: 'business',
      });
      return {
        said: `Done — ${money(reading.amount ?? 0)} expense.`,
        href: '/expenses',
        undo: written ? () => store.deleteExpense(written.id) : undefined,
      };
    }

    case 'other_income': {
      const written = await store.addAdditionalRevenue({
        date,
        description: reading.description || reading.summary || 'Spoken income',
        amount: reading.amount ?? 0,
      });
      return {
        said: `Done — ${money(reading.amount ?? 0)} in.`,
        href: '/additional-revenue',
        undo: written ? () => store.deleteAdditionalRevenue(written.id) : undefined,
      };
    }

    case 'new_customer': {
      const fields = reading.fields ?? {};
      const created = await store.addCustomer({ ...fields, name: fields.name! });
      if (!created) throw new Error('Could not add that customer.');
      return {
        said: `Added ${created.name}.`,
        href: `/customers/${created.id}`,
        undo: () => store.deleteCustomer(created.id),
      };
    }

    case 'new_karigar': {
      const fields = reading.fields ?? {};
      const created = await store.addKarigar({ ...fields, name: fields.name! });
      if (!created) throw new Error('Could not add that karigar.');
      return {
        said: `Added ${created.name}.`,
        href: `/karigars/${created.id}`,
        undo: () => store.deleteKarigar(created.id),
      };
    }

    case 'edit_customer': {
      const person = reading.person;
      if (!person) throw new Error('No name matched anyone in the book.');
      await store.updateCustomer(person.id, reading.fields ?? {});
      return { said: `Updated ${person.name}.`, href: `/customers/${person.id}` };
    }

    case 'edit_karigar': {
      const person = reading.person;
      if (!person) throw new Error('No name matched anyone in the book.');
      await store.updateKarigar(person.id, reading.fields ?? {});
      return { said: `Updated ${person.name}.`, href: `/karigars/${person.id}` };
    }

    default:
      throw new Error(`Nothing to write for "${reading.action}".`);
  }
}
