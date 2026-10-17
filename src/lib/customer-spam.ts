/**
 * Bot sign-ups among the customers: Customers' "Clean up spam" (customers/page.tsx), and the phone's own
 * review of them (apps/iphone, ERPCore Logic/CustomerSpam.swift, ported line for line with these cases).
 *
 * Bot signup spam (e.g. from a public Shopify storefront) shows up as customers with gibberish two-token
 * names, a random free-email address, and NO phone, NO address, and NO transaction history. We only ever
 * flag rows that satisfy ALL of those negatives, so a real customer who merely lacks a phone is safe.
 */

/** What the detector reads of a customer. */
export interface SpamCheckCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface SpamCandidate<C extends SpamCheckCustomer = SpamCheckCustomer> {
  customer: C;
  reasons: string[];
}

export function tokenGibberishScore(tok: string): number {
  if (tok.length < 2) return 0;
  let score = 0;
  // Internal capitals (an uppercase letter immediately after a lowercase one) —
  // real names are Title Case; "ABajEyYE" style camel-noise is a strong signal.
  let internalCaps = 0;
  for (let i = 1; i < tok.length; i++) {
    const prev = tok[i - 1], cur = tok[i];
    if (cur >= 'A' && cur <= 'Z' && prev >= 'a' && prev <= 'z') internalCaps++;
  }
  score += internalCaps;
  // Frequent case flips (UPPER<->lower) across the token.
  let transitions = 0;
  for (let i = 1; i < tok.length; i++) {
    const aU = tok[i - 1] >= 'A' && tok[i - 1] <= 'Z';
    const bU = tok[i] >= 'A' && tok[i] <= 'Z';
    if (aU !== bU) transitions++;
  }
  if (transitions >= 4) score += 2;
  // Long consonant runs.
  if (/[bcdfghjklmnpqrstvwxyz]{4,}/i.test(tok)) score += 2;
  // Very low vowel ratio on a reasonably long token.
  const vowels = (tok.match(/[aeiou]/gi) || []).length;
  const letters = (tok.match(/[a-z]/gi) || []).length;
  if (letters >= 5 && vowels / letters < 0.2) score += 2;
  return score;
}

export function isGibberishName(name: string): boolean {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const total = tokens.reduce((s, t) => s + tokenGibberishScore(t), 0);
  return total >= 3;
}

export function isRandomEmailLocal(email?: string): boolean {
  if (!email) return false;
  const local = (email.split('@')[0] || '').replace(/[._-]/g, '');
  if (local.length < 12) return false;
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(local)) return true;
  const vowels = (local.match(/[aeiou]/gi) || []).length;
  const letters = (local.match(/[a-z]/gi) || []).length || 1;
  return vowels / letters < 0.28;
}

/**
 * The customers with any order, invoice or hisaab row: never flagged as spam (the old khata's customers
 * have a name and a ledger, no phone and no sale here).
 */
export function transactedCustomerIds(
  orders: readonly { customerId?: string | null }[],
  invoices: readonly { customerId?: string | null }[],
  hisaab: readonly { entityType?: string; entityId?: string }[],
): Set<string> {
  const ids = new Set<string>();
  for (const o of orders) if (o.customerId) ids.add(o.customerId);
  for (const inv of invoices) if (inv.customerId) ids.add(inv.customerId);
  for (const h of hisaab) if (h.entityType === 'customer' && h.entityId) ids.add(h.entityId);
  return ids;
}

export function detectSpamCustomers<C extends SpamCheckCustomer>(customers: readonly C[], transactedIds: Set<string>): SpamCandidate<C>[] {
  const out: SpamCandidate<C>[] = [];
  for (const c of customers) {
    const hasPhone = !!(c.phone && c.phone.trim());
    const hasAddress = !!(c.address && c.address.trim());
    const hasHistory = transactedIds.has(c.id);
    if (hasPhone || hasAddress || hasHistory) continue;
    const reasons: string[] = [];
    if (isGibberishName(c.name)) reasons.push('Gibberish name');
    if (isRandomEmailLocal(c.email)) reasons.push('Random email');
    if (reasons.length === 0) continue;
    reasons.push('No phone / address / orders');
    out.push({ customer: c, reasons });
  }
  return out;
}
