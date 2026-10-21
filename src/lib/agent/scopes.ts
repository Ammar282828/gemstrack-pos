/**
 * What an AI key may do (docs/features/ai-keys.md). One table, read by the Settings screen (the
 * checkboxes), the server (every tool names the scope it needs) and the docs. Pure.
 *
 * The owner, 2026-10-21: "an API key thing so that I can use other AI to go into the ERP and make posts
 * for me and stuff". Making a post is the default; sending one, and any write to the books, is opted into.
 */

import { STORE_AD_STUDIO } from '@/lib/store-config';

export const SCOPE_IDS = ['posts:draft', 'posts:publish', 'read', 'write:shop', 'write:money', 'studio'] as const;
export type Scope = (typeof SCOPE_IDS)[number];

export interface ScopeInfo {
  id: Scope;
  label: string;
  /** What it lets the AI do, in the owner's words. */
  detail: string;
  /** Ticked when a key is made. */
  byDefault: boolean;
  /** This house has it at all. */
  available: () => boolean;
}

export const SCOPES: readonly ScopeInfo[] = [
  {
    id: 'posts:draft', label: 'Make posts', byDefault: true, available: () => true,
    detail: 'Find pieces and photographs, make stories and posts in the house’s layouts, and put them in the queue. Nothing goes out until you approve it in Posts.',
  },
  {
    id: 'posts:publish', label: 'Send posts', byDefault: false, available: () => true,
    detail: 'Send or schedule queued posts to WhatsApp and Instagram without asking you first.',
  },
  {
    id: 'read', label: 'Read the books', byDefault: true, available: () => true,
    detail: 'Orders, invoices, customers, what is owed, today’s cash, stock and website pieces, gold rates, the month’s figures.',
  },
  {
    id: 'write:shop', label: 'Change the shop', byDefault: false, available: () => true,
    detail: 'Customers, order status, repairs, given items and the team note. Deleting anything still needs the delete code.',
  },
  {
    id: 'write:money', label: 'Take money', byDefault: false, available: () => true,
    detail: 'Sales and invoices, payments, advances, expenses and today’s rates. Deleting anything still needs the delete code.',
  },
  {
    id: 'studio', label: 'Ad studio boards', byDefault: false, available: () => STORE_AD_STUDIO,
    detail: 'Work on the Ad studio’s boards (Design › Board): add designs, look at them, leave notes.',
  },
];

export const isScope = (v: unknown): v is Scope => typeof v === 'string' && (SCOPE_IDS as readonly string[]).includes(v);

/** The scopes this house offers. */
export const availableScopes = (): ScopeInfo[] => SCOPES.filter(s => s.available());

/** A list from a request, cleaned: known, offered here, each once, in the table's order. */
export function cleanScopes(raw: unknown): Scope[] {
  const asked = new Set(Array.isArray(raw) ? raw.filter(isScope) : []);
  return availableScopes().map(s => s.id).filter(id => asked.has(id));
}

export const scopeLabel = (id: Scope): string => SCOPES.find(s => s.id === id)?.label ?? id;
