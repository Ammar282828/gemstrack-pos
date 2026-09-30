/**
 * Who each signed-in Google account is at the counter, so the ERP can start from them: "Taken
 * by" on a new order, sale or repair, and the Orders, Invoices and Workshop lists filtered to
 * them (the owner, 2026-09-30: "taken by defaults to ammar when potatomasta is logged in /
 * workshop filters to ammar / orders filter to ammar").
 *
 * Only a default — always shown, always changeable. A device signed in as one person but
 * handed across the counter would otherwise credit everyone's sales to them, which is why
 * "Taken by" never followed the login before.
 *
 * `NEXT_PUBLIC_STORE_PEOPLE`, per house: "email=Name,email=Name". A name that isn't on the
 * house's Taken by list (TAKEN_BY) is ignored, so a typo can't invent a counter person.
 */

import { STORE_TAKEN_BY } from '@/lib/store-config';

export function parsePeople(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of String(raw ?? '').split(',')) {
    const [email, name] = pair.split('=').map(s => s?.trim());
    if (email && name && email.includes('@')) out[email.toLowerCase()] = name;
  }
  return out;
}

export const STORE_PEOPLE = parsePeople(process.env.NEXT_PUBLIC_STORE_PEOPLE);

/** The counter name for a signed-in account, if it has one on this house's list. */
export function personFor(
  email: string | null | undefined,
  people: Record<string, string> = STORE_PEOPLE,
  names: readonly string[] = STORE_TAKEN_BY,
): string | undefined {
  const name = email ? people[email.trim().toLowerCase()] : undefined;
  return name && names.includes(name) ? name : undefined;
}
