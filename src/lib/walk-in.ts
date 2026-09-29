/**
 * A walk-in: a sale to nobody in particular. No customer picked, no name typed, no number.
 *
 * It is not a customer. Until 2026-09-29 the cart sent "Walk-in Customer" as the name and
 * generateInvoice made a customer of any name it was given without an id, so every walk-in
 * sale added a "Walk-in Customer" to the book (17 in Taheri's by then). The usual shape: the
 * counter billed first, took the money, then edited the invoice to put the real name on it,
 * which re-saved it against a new customer and left the walk-in one pointing at nothing.
 *
 * Now a walk-in invoice carries no customerId and "Walk-in Customer" as its name; a balance
 * it leaves goes to the hisaab under the fixed entity 'walk-in'. A typed name or number is a
 * real person and still becomes a customer, unless the number is already on file.
 */

export const WALK_IN_NAME = 'Walk-in Customer';
/** The hisaab entityId for a balance nobody's name is on; also what Analytics keys them by. */
export const WALK_IN_ENTITY = 'walk-in';

/** "Walk-in Customer", "walk in", "Walkin"… — but not "Walk-in Customer - 0300…", a real number. */
export function isWalkInName(name: string | null | undefined): boolean {
  return /^walk[\s-]*in(?:[\s-]+customer)?$/i.test(String(name ?? '').trim());
}

/** The last ten digits, so 0300…, +92300… and 92300… are the same number; '' for too few. */
export function phoneKey(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : '';
}

const nameKey = (name: string | null | undefined) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

type Known = { id: string; name: string; phone?: string };

export type SaleCustomer = {
  /** Set when the sale goes to someone already in the book. */
  id?: string;
  name: string;
  phone: string;
  /** A person not yet in the book: generateInvoice adds them. Never true for a walk-in. */
  isNew: boolean;
};

/**
 * Who a sale in the cart is for.
 *
 * - A customer picked from the list is that customer (their number, or the one typed if they
 *   have none). A picked "Walk-in Customer" left over from before is not a person: it is read
 *   as a walk-in, so re-saving one of those invoices lets go of it.
 * - Otherwise a typed number already on file is that customer, when no name was typed or the
 *   name typed is theirs. Typing rather than tapping the suggestion no longer makes a second
 *   copy of somebody (House of Mina's book has one number under 23 "Nilofar"s). A number that
 *   belongs to someone of another name is left alone: two people can share a phone.
 * - A typed name, or a number nobody has, is a new customer; a number alone is named
 *   "Walk-in Customer - <number>", as before.
 * - Nothing typed, or only the placeholder (an edited walk-in invoice puts "Walk-in Customer"
 *   back in the name box): a walk-in, and no customer is made.
 */
export function resolveSaleCustomer(input: {
  selectedId?: string;
  typedName?: string;
  typedPhone?: string;
  customers: readonly Known[];
}): SaleCustomer {
  const typedPhone = String(input.typedPhone ?? '').trim();
  const typedName = isWalkInName(input.typedName) ? '' : String(input.typedName ?? '').trim();

  const picked = input.selectedId ? input.customers.find(c => c.id === input.selectedId) : undefined;
  if (input.selectedId && !picked) {
    // Not in the list this device holds (just added elsewhere, or removed): keep the id and
    // let generateInvoice read the record, as it always has.
    return { id: input.selectedId, name: typedName, phone: typedPhone, isNew: false };
  }
  if (picked && !isWalkInName(picked.name)) {
    return { id: picked.id, name: picked.name, phone: picked.phone || typedPhone, isNew: false };
  }

  const key = phoneKey(typedPhone);
  if (key) {
    const sameNumber = input.customers
      .filter(c => !isWalkInName(c.name) && phoneKey(c.phone) === key)
      .sort((a, b) => a.id.localeCompare(b.id));
    const names = new Set(sameNumber.map(c => nameKey(c.name)));
    const match = typedName
      ? sameNumber.find(c => nameKey(c.name) === nameKey(typedName))
      : names.size === 1 ? sameNumber[0] : undefined;
    if (match) return { id: match.id, name: match.name, phone: match.phone || typedPhone, isNew: false };
  }

  if (typedName) return { name: typedName, phone: typedPhone, isNew: true };
  if (typedPhone) return { name: `${WALK_IN_NAME} - ${typedPhone}`, phone: typedPhone, isNew: true };
  return { name: WALK_IN_NAME, phone: '', isNew: false };
}

/** generateInvoice's side of it: make a customer only for a person, never for the placeholder. */
export function shouldCreateCustomer(info: { id?: string; name?: string }): boolean {
  return !info.id && Boolean(info.name?.trim()) && !isWalkInName(info.name);
}

/**
 * Who a sale is credited to in Analytics: its customer, else the name it was written for,
 * else nobody. Every walk-in is the one row, however it was recorded: no id, the
 * placeholder name, or (from before 2026-09-29) a customer of its own still named
 * "Walk-in Customer". `currentName` is the book's name for an id, so one of those renamed
 * since to a real person counts as that person.
 */
export function saleCustomerKey(
  sale: { customerId?: string | null; customerName?: string | null },
  currentName?: (id: string) => string | undefined,
): string {
  const id = sale.customerId && sale.customerId !== WALK_IN_ENTITY ? sale.customerId : '';
  if (id) return isWalkInName(currentName?.(id) ?? sale.customerName) ? WALK_IN_ENTITY : id;
  const name = String(sale.customerName ?? '').trim();
  return name && !isWalkInName(name) ? `name:${name}` : WALK_IN_ENTITY;
}
