/**
 * Sending a document to its customer on WhatsApp from the shop's own line: the pure parts, shared by
 * the route (/api/app/whatsapp/send-doc, lib/customer-doc-server.ts) and its tests.
 *
 * Owner, 2026-11-02: "allow me to send the pdf (order or invoice) directly to the customer on whatsapp
 * (use my number whatsapp api for this)". Both houses: each sends from its own line (WAHA session per
 * house: Taheri's "default", Mina's "mina", apphosting.mina.yaml). Where no line is connected the
 * caller falls back to opening WhatsApp on the device with a link.
 */

import { toWhatsAppNumber } from '@/lib/whatsapp';

export type CustomerDocKind = 'invoice' | 'order';

export interface SendDocRequest {
  kind: CustomerDocKind;
  id: string;
  /** The number typed in the confirm sheet; left out, the customer's on file. */
  to?: string;
  /** Invoices only: one invoice per piece, each on its own page. */
  perPiece: boolean;
}

/** The request body, checked: a kind, a document id, and the optional number and per-piece choice. */
export function parseSendDoc(body: unknown): SendDocRequest | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const kind = b.kind;
  if (kind !== 'invoice' && kind !== 'order') return { error: "Say which document: 'invoice' or 'order'." };
  const id = typeof b.id === 'string' ? b.id.trim() : '';
  if (!id || id.length > 200 || id.includes('/')) return { error: 'Which invoice or order?' };
  const to = typeof b.to === 'string' && b.to.trim() ? b.to.trim() : undefined;
  return { kind, id, to, perPiece: kind === 'invoice' && b.perPiece === true };
}

/** A dialable WhatsApp number: 11 to 15 digits with its country code. */
export const isWhatsAppNumber = (digits: string) => /^\d{11,15}$/.test(digits);

/**
 * Who it goes to: the number typed, else the one on the document, else the customer's on file (their
 * main number, then their second). Digits with the country code (lib/whatsapp.ts toWhatsAppNumber:
 * 03xx → 923xx); an error when none of them is a WhatsApp number.
 */
export function resolveRecipient(typed: string | undefined, onFile: (string | null | undefined)[]): { to: string } | { error: string } {
  if (typed) {
    const to = toWhatsAppNumber(typed);
    return isWhatsAppNumber(to) ? { to } : { error: `${typed} isn't a WhatsApp number — check it.` };
  }
  for (const n of onFile) {
    const to = toWhatsAppNumber(n);
    if (isWhatsAppNumber(to)) return { to };
  }
  return { error: "There's no phone number on file for this customer. Enter one." };
}

/** "+92 300 ••• 4567": enough to recognise the number, not to copy it from a screenshot. */
export function maskNumber(digits: string): string {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length < 7) return d ? `+${d}` : '';
  return `+${d.slice(0, 2)} ${d.slice(2, 5)} ••• ${d.slice(-4)}`;
}

/** The line this house sends from, or why it can't: a refusal the caller turns into "send a link instead". */
export function lineGate(provider: string | null): { status: 503; error: string; fallback: 'link' } | null {
  return provider ? null : { status: 503, error: "This shop's WhatsApp line isn't connected to the ERP.", fallback: 'link' };
}
