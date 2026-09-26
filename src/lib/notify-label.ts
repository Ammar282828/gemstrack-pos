/**
 * Which POS a WhatsApp alert came from (the owner, 2026-09-26: "message alerts for each pos
 * should state where they are coming from since I get both").
 *
 * Both houses send their alerts to the owner's phone, so every alert to the shop — a sale, a
 * payment, the daily and weekly reports, a website order — starts with the house's name in
 * bold, on the first line where a phone's notification shows it. Messages to customers are
 * not labelled (they already speak as the shop).
 *
 * The label is a variable like every other difference between the houses:
 * NEXT_PUBLIC_STORE_NOTIFY_LABEL (apphosting.mina.yaml says "House of Mina POS"); without it,
 * the store's name in title case and "POS" — "Taheri POS".
 */

import { STORE_CONFIG } from '@/lib/store-config';

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export const POS_LABEL: string =
  process.env.NEXT_PUBLIC_STORE_NOTIFY_LABEL?.trim() || `${titleCase(STORE_CONFIG.name || 'POS')} POS`;

/** The alert with this POS's name in front, once. */
export function fromThisPos(message: string, label = POS_LABEL): string {
  const tag = `*${label}*`;
  return message.startsWith(tag) ? message : `${tag} · ${message}`;
}
