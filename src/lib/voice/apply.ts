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

import type { AppState, HisaabEntityType, OrderStatus, PaymentType } from '@/lib/store';
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
  | 'recordOrderAdvance' | 'updateOrderStatus' | 'updateOrder' | 'updateInvoicePayment'
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

    /*
     * The work at the bench and the bills already raised. Each goes through the same
     * store action the order page or the invoice page would call, so a spoken advance
     * and a typed one are the same row with the same activity log behind it.
     */
    case 'order_advance': {
      const doc = reading.doc;
      const amount = reading.amount ?? 0;
      if (!doc) throw new Error('No order to put that on.');
      const updated = await store.recordOrderAdvance(doc.id, amount, reading.description || 'Spoken advance');
      if (!updated) throw new Error('The advance was not recorded.');
      const left = Math.max(0, updated.grandTotal);
      return {
        said: `Done — ${money(amount)} advance on ${doc.id} for ${doc.customerName}; ${left > 0 ? `${money(left)} to collect` : 'nothing left to collect'}.`,
        href: doc.href,
        // Put back what the order carried before, rather than recording a negative advance.
        undo: () => store.updateOrder(doc.id, { advancePayment: doc.advancePayment ?? 0, grandTotal: doc.balance }),
      };
    }

    case 'order_status': {
      const doc = reading.doc;
      const status = reading.status as OrderStatus | null;
      if (!doc || !status) throw new Error('No order, or no status.');
      await store.updateOrderStatus(doc.id, status);
      const before = doc.status as OrderStatus | undefined;
      return {
        said: `Done — ${doc.id} for ${doc.customerName} is ${status.toLowerCase()}.`,
        href: doc.href,
        undo: before ? () => store.updateOrderStatus(doc.id, before) : undefined,
      };
    }

    case 'order_promise': {
      const doc = reading.doc;
      const date = reading.date;
      if (!doc || !date) throw new Error('No order, or no date.');
      await store.updateOrder(doc.id, { promisedDate: date });
      return {
        said: `Done — ${doc.id} for ${doc.customerName} is now promised for ${date}.`,
        href: doc.href,
        undo: doc.promisedDate ? () => store.updateOrder(doc.id, { promisedDate: doc.promisedDate }) : undefined,
      };
    }

    case 'invoice_payment': {
      const doc = reading.doc;
      const amount = reading.amount ?? 0;
      if (!doc) throw new Error('No invoice to put that against.');
      const updated = await store.updateInvoicePayment(doc.id, amount, date, (reading.method ?? 'Cash') as PaymentType);
      if (!updated) throw new Error('The payment was not recorded.');
      const left = Math.max(0, updated.balanceDue);
      return {
        said: `Done — ${money(amount)} against ${doc.id} for ${doc.customerName}; ${left > 0 ? `${money(left)} left` : 'paid in full'}.`,
        href: doc.href,
        // A payment on an invoice is reversed from the invoice page, as a refund, so it
        // leaves a trace. Not by a word said a minute later.
        undo: undefined,
      };
    }

    default:
      throw new Error(`Nothing to write for "${reading.action}".`);
  }
}
