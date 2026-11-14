/**
 * How the ERP reaches a customer, worked out once (owner, 2026-11-02: "organize the pdf and whatsapp and
 * phone and messaging for customers properly"). Every place a customer appears — their page, an invoice,
 * an order, a repair, an online order, their hisaab — shows the same Contact control
 * (components/customer/contact-actions.tsx), in this order: Call, WhatsApp, Message, then on an invoice
 * or order Send the PDF on WhatsApp (from the shop's line) and Share PDF, then Copy number. The iPhone's
 * is App/UI/CustomerContact.swift and Android's ui/CustomerContact.kt, to the same rules.
 *
 * One number for all of them: lib/whatsapp.ts `toWhatsAppNumber` (03xx → +923xx; a "+" or "00" number
 * from abroad kept as written). A walk-in is nobody to call: no contact actions, only the document's.
 */

import { toWhatsAppNumber } from '@/lib/whatsapp';
import { isWalkInName } from '@/lib/walk-in';

export interface ContactHrefs {
  /** "+923001234567": what is dialled, copied and sent to. */
  e164: string;
  tel: string;
  whatsapp: string;
  sms: string;
}

/** The three links for a number; null when there is nothing dialable. */
export function contactHrefs(phone: string | null | undefined, message = ''): ContactHrefs | null {
  const digits = toWhatsAppNumber(phone);
  if (digits.length < 10) return null;
  const e164 = `+${digits}`;
  return {
    e164,
    tel: `tel:${e164}`,
    whatsapp: `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`,
    // `?&body=` is read by both iOS (`&body=`) and Android (`?body=`).
    sms: `sms:${e164}${message ? `?&body=${encodeURIComponent(message)}` : ''}`,
  };
}

/** Is this the counter's nobody-in-particular, who gets no Call/WhatsApp/Message? */
export function isWalkInContact(c: { customerId?: string | null; customerName?: string | null }): boolean {
  return !c.customerId && (!c.customerName || isWalkInName(c.customerName));
}
