/**
 * An invoice's settlement, derived in ONE place (2026-11-11). Whether an invoice is due, partly paid, paid, in credit or
 * refunded used to be worked out afresh by the credit line, the PDF, the WhatsApp caption, the voice lists, the ledger
 * sync and the order badge, and they disagreed: a Shopify-voided invoice was marked Refunded yet kept its balance, so the
 * PDF and the share text still said "Balance due".
 *
 * Not a stored status (nothing is written under this name): a pure function of the invoice's `status`, `balanceDue` and
 * `amountPaid`, declared like a machine so the apps read its labels and tones from machines.json (`derived`).
 *
 * Rules, in order: status Refunded wins (nothing is owed or held on a refunded invoice, whatever its balance still says);
 * then whole rupees as everywhere (lib/money: a balance under 1 rupee either way is settled).
 *
 * A status of 'Cancelled' is not an invoice status (nothing writes it; invoices are Paid / Unpaid / Refunded). Old readers
 * that test for it (shopify-orders.ts, conversionFor) are legacy-readable only: kept, never extended.
 */
import { isCredit, owesMoney } from '@/lib/money';

export const SETTLEMENT_STATES = ['due', 'partly', 'paid', 'credit', 'refunded'] as const;
export type SettlementState = typeof SETTLEMENT_STATES[number];

export const SETTLEMENT_LABELS: Record<SettlementState, string> = {
  due: 'Balance due',
  partly: 'Balance due',
  paid: 'Paid in full',
  credit: 'Credit to customer',
  refunded: 'Refunded',
};

export const SETTLEMENT_TONES: Record<SettlementState, 'late' | 'owed' | 'settled' | 'credit' | 'working' | 'quiet' | 'house'> = {
  due: 'late',
  partly: 'owed',
  paid: 'settled',
  credit: 'credit',
  refunded: 'quiet',
};

export interface SettlementInput { status?: string | null; balanceDue?: number | null; amountPaid?: number | null }

export interface Settlement {
  state: SettlementState;
  label: string;
  tone: typeof SETTLEMENT_TONES[SettlementState];
  /** What the customer owes, as stored (0 unless due or partly). */
  amountDue: number;
  /** What the shop holds for the customer, positive (0 unless credit). */
  credit: number;
}

export function settlementOf(inv: SettlementInput | null | undefined): Settlement {
  const make = (state: SettlementState, amountDue = 0, credit = 0): Settlement =>
    ({ state, label: SETTLEMENT_LABELS[state], tone: SETTLEMENT_TONES[state], amountDue, credit });
  if (inv?.status === 'Refunded') return make('refunded');
  const b = Number(inv?.balanceDue) || 0;
  if (owesMoney(b)) return make((Number(inv?.amountPaid) || 0) > 0 ? 'partly' : 'due', b);
  if (isCredit(b)) return make('credit', 0, -b);
  return make('paid');
}

/** For machines.json (export.ts `derived`) and docs/state-machines.md. */
export const SETTLEMENT_DERIVED = {
  name: 'Invoice settlement',
  field: 'derived from invoices/<id>.status, balanceDue, amountPaid (never stored)',
  states: SETTLEMENT_STATES,
  labels: SETTLEMENT_LABELS,
  tones: SETTLEMENT_TONES,
  rule: 'status Refunded: refunded. Else in whole rupees (under 1 settled): balance 1 or more: partly if anything was paid, else due; balance -1 or less: credit; otherwise paid.',
} as const;
