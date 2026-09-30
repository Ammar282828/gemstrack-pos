/**
 * Who a given item went to, by id as well as by name.
 *
 * The Given page only ever wrote the name, so a customer merge (which moves given items by
 * `recipientId`) and the karigar's page could not find them (the audit of 2026-10-01). A name
 * picked from the karigars or customers resolves to that record — when exactly one live record
 * carries it; two customers of one name stay unlinked rather than guessed.
 */

export type RecipientType = 'karigar' | 'customer' | 'other';
type Named = { id: string; name: string; deletedAt?: string };

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function resolveRecipientId(type: RecipientType, name: string, karigars: readonly Named[], customers: readonly Named[]): string | undefined {
  if (type === 'other' || !name.trim()) return undefined;
  const pool = type === 'karigar' ? karigars : customers;
  const hits = pool.filter(r => !r.deletedAt && norm(r.name) === norm(name));
  return hits.length === 1 ? hits[0].id : undefined;
}
