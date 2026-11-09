/**
 * Pure helpers for Safepay payment links on the web (owner, 2026-11-09): the key's shape, and the WhatsApp line a link goes
 * out with. The server's rule lives in lib/safepay.ts (isSafepayPublicKey); this copy has no server imports so the browser
 * can use it.
 */
import { rupees } from '@/lib/money';

export const SAFEPAY_KEY_RE = /^sec_[0-9a-f-]{20,64}$/i;
export const isSafepayKey = (k: string): boolean => SAFEPAY_KEY_RE.test(k.trim());

/** Whole rupees from what was typed or computed; never below 0. */
export const linkAmount = (n: unknown): number => Math.max(0, rupees(Number(n) || 0));

/** "Assalam o Alaikum <name>, please pay PKR <amount> for <id> here: <url> — <house>" (no name: no name). */
export function paymentLinkMessage(o: { name?: string; amount: number; id: string; url: string; store: string }): string {
  const who = o.name && o.name.trim() ? ` ${o.name.trim()}` : '';
  return `Assalam o Alaikum${who}, please pay PKR ${linkAmount(o.amount).toLocaleString('en-US')} for ${o.id} here: ${o.url} — ${o.store}`;
}
