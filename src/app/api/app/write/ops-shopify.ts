/**
 * Old Shopify sales made orders (owner, 2026-11-09, docs/decisions.md "Shopify section"): the Shopify section's
 * "Make orders of the N open Shopify sales" and the invoice page's "Make it an order". Owners only; it removes invoices,
 * so the delete code comes with it and is checked here (decision "Delete code"); it moves money (advances), so a request id
 * is required and a repeat is answered with the first answer.
 *
 *   { op: 'shopifyInvoicesToOrders', invoiceIds: string[] (1..100), deleteCode, requestId }
 *   → { ok: true, converted: [{ invoiceId, orderId }], skipped: [{ invoiceId, reason }], followUps }
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { normalizePhoneNumber } from '@/lib/utils';
import { cleanObject } from '@/lib/writes/create-invoice';
import { MAX_CONVERT, convertWhat, shopifyInvoicesToOrders } from '@/lib/writes/shopify-invoice-to-order';
import type { OpHandler, OpRoles } from './op-context';

export const SHOPIFY_OPS: OpRoles = {
  shopifyInvoicesToOrders: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

export const runShopifyOp: OpHandler = async (op, body, ctx) => {
  if (!(op in SHOPIFY_OPS)) return null;

  const ids = Array.isArray(body.invoiceIds) ? body.invoiceIds.map(idOf) : [];
  if (!ids.length || ids.some(i => !i)) return bad('Which invoices?');
  if (ids.length > MAX_CONVERT) return bad(`At most ${MAX_CONVERT} invoices at a time.`);
  const unique = [...new Set(ids)];

  const code = await passDeleteCode(ctx.email, body.deleteCode, convertWhat(unique));
  if (!code.ok) return bad(code.error, code.status);

  const out = await shopifyInvoicesToOrders(adminPort, unique, {
    createCustomer: async (c) => {
      const id = `cust-${Date.now()}`;
      await adminDb.collection('customers').doc(id).set({ id, name: c.name, phone: normalizePhoneNumber(c.phone) || '', email: '', address: '' });
      await ctx.log('customer.create', `Created customer: ${c.name}`, `ID: ${id}`, id);
      return { id, name: c.name };
    },
    normalizePhone: (v) => normalizePhoneNumber(v),
    clean: cleanObject,
    deleteField: () => FieldValue.delete(),
    by: ctx.email,
  }, { log: ctx.log });
  return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
};
