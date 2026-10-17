/**
 * The last of the Workshop and Activity native on the phone: an order's or a sold piece's making details
 * (the Workshop's Details dialog, lib/writes/piece-details.ts) and the Emergency lock (Activity's "Lock Database
 * Now", lib/writes/database-lock.ts). Each runs its shared write on the Admin SDK.
 *
 * Owners only: in the browser these are direct Firestore writes, and the shop floor has no Firestore access;
 * Activity is the owners' page. Revert on Activity is no op of its own: it is the delete it always was
 * (deleteInvoice, deleteOrder, deleteExpense), with the delete code.
 *
 * Bodies are checked strictly, as ops-workshop.ts checks a stock job's details: only the fields named are read,
 * a field of the wrong shape is refused rather than guessed at, and a piece that is not on file is refused (409).
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { personFor } from '@/lib/people';
import { lockDatabase } from '@/lib/writes/database-lock';
import { PieceDetailsRefusal, updateInvoicePieceDetails, updateOrderPieceDetails, type OrderItemDetails } from '@/lib/writes/piece-details';
import type { InvoiceItemDetails } from '@/lib/workshop-details';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const WORK2_OPS: OpRoles = {
  updateOrderPieceDetails: ['owner'],
  updateInvoicePieceDetails: ['owner'],
  lockDatabase: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** Text of at most `max` letters, trimmed; null when it is not text or too long. A missing field is empty. */
const textOf = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length <= max ? s : null;
};

/** A piece's place on its order or invoice: a whole number from 0. */
const indexOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 500 ? v : null);

/** A sample picture as the phone sends it: a JPEG or PNG data URI the size the order form makes (NewOrderPhotoCodec). */
const MAX_PHOTO = 700_000;
const isPhoto = (v: string) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= MAX_PHOTO;

/** The fields both kinds of piece take: the name (never cleared), the size and the instructions. */
function sharedFields(sent: Record<string, unknown>): { name?: string; size?: string; adminNote?: string } | string {
  const out: { name?: string; size?: string; adminNote?: string } = {};
  if ('name' in sent) {
    const d = textOf(sent.name, 300);
    if (!d) return 'An item needs a name.';
    out.name = d;
  }
  if ('size' in sent) {
    const s = textOf(sent.size, 60);
    if (s === null) return 'The size is text of up to 60 letters.';
    out.size = s;
  }
  if ('instructions' in sent) {
    const n = textOf(sent.instructions, 2000);
    if (n === null) return 'The instructions are text of up to 2000 letters.';
    out.adminNote = n;
  }
  return out;
}

export const runWork2Op: OpHandler = async (op, body, ctx) => {
  const fx = { log: ctx.log };
  const ok = (out: Record<string, unknown>) => NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
  const raw = body.patch;
  const sent = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

  try {
    switch (op) {
      case 'updateOrderPieceDetails': {
        const orderId = idOf(body.orderId);
        const itemIndex = indexOf(body.itemIndex);
        if (!orderId || itemIndex === null || !sent) return bad('Bad request');
        const shared = sharedFields(sent);
        if (typeof shared === 'string') return bad(shared);
        // Instructions are kept in the owner's note; the old stone and diamond lines are cleared so nothing
        // shows twice (the dialog's own write).
        const patch: OrderItemDetails = {
          ...(shared.name !== undefined && { description: shared.name }),
          ...(shared.size !== undefined && { size: shared.size }),
          ...(shared.adminNote !== undefined && { adminNote: shared.adminNote, stoneDetails: '', diamondDetails: '' }),
        };
        if ('referenceSku' in sent) {
          const r = textOf(sent.referenceSku, 80);
          if (r === null) return bad('The reference SKU is text of up to 80 letters.');
          patch.referenceSku = r;
        }
        if ('estimatedWeightG' in sent) {
          const w = sent.estimatedWeightG;
          if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1e6) return bad('Weight must be a figure of 0 or more.');
          patch.estimatedWeightG = w;
        }
        if ('sampleImageDataUri' in sent) {
          const p = sent.sampleImageDataUri;
          if (p !== '' && (typeof p !== 'string' || !isPhoto(p))) return bad('The sample picture could not be read. Choose it again.');
          patch.sampleImageDataUri = p as string;
        }
        if (!Object.keys(patch).length) return bad('Nothing to change.');
        return ok(await updateOrderPieceDetails(adminPort, { orderId, itemIndex, patch }, fx));
      }

      case 'updateInvoicePieceDetails': {
        const invoiceId = idOf(body.invoiceId);
        const itemIndex = indexOf(body.itemIndex);
        if (!invoiceId || itemIndex === null || !sent) return bad('Bad request');
        const shared = sharedFields(sent);
        if (typeof shared === 'string') return bad(shared);
        // Its weight is what the bill was priced from, so none is taken; nor a reference or a picture.
        const patch: InvoiceItemDetails = {
          ...(shared.name !== undefined && { name: shared.name }),
          ...(shared.size !== undefined && { size: shared.size }),
          ...(shared.adminNote !== undefined && { adminNote: shared.adminNote, stoneDetails: '', diamondDetails: '' }),
        };
        if (!Object.keys(patch).length) return bad('Nothing to change.');
        return ok(await updateInvoicePieceDetails(adminPort, { invoiceId, itemIndex, patch }, fx));
      }

      case 'lockDatabase': {
        // The page's own confirmation is the phone's to ask; sent without it, nothing happens.
        if (body.confirm !== true) return bad('Confirm the lock first.');
        return ok(await lockDatabase(adminPort, { by: personFor(ctx.email) || ctx.email }, fx));
      }
    }
  } catch (e) {
    if (e instanceof PieceDetailsRefusal) return bad(e.message, 409);
    throw e;
  }
  return null;
};
