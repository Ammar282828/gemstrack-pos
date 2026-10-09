/**
 * A repair ticket edited or deleted (src/app/repairs/page.tsx: the form on a ticket, and Delete), native
 * on the phone. Each runs lib/writes/repair-admin.ts, the copy the store can take up, on the Admin SDK.
 * Taking a ticket in, Ready, Collected and money taken are addRepair, setRepairStatus and
 * recordRepairPayment in route.ts.
 *
 * Owners only, as every repair write is: in the browser they are direct Firestore writes, and the shop
 * floor has no Firestore access.
 *
 * The edit is the whole form, as the web's Save sends it: every field it shows, a field left empty
 * removed. Only those fields are read, text is trimmed, and a field of the wrong shape is refused rather
 * than guessed at. The karigar's name is the karigar's own, read here, so a ticket never names someone
 * the book does not. Delete asks for the delete code (decision "Delete code"), checked here before
 * anything is touched; a ticket already gone is said before the code is asked for, so no try is spent.
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { normalizePhoneNumber } from '@/lib/utils';
import { deleteRepair, repairPiecesFrom, updateRepair, type RepairEdit } from '@/lib/writes/repair-admin';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const REPAIR_OPS: OpRoles = {
  updateRepair: ['owner'],
  deleteRepair: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** The shared write says "No such …" for a ticket that is not on file: a refusal, not a crash. */
const missing = (e: unknown) => (e instanceof Error && /^No such /.test(e.message) ? bad(e.message, 409) : null);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Cleaned<T> = { ok: true; value: T } | { ok: false; error: string };

/** Text of up to `max` letters, trimmed; '' when not sent. Null when it is not text. */
function textOf(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max) return null;
  return v.trim();
}

/** A weight or a price: a figure of 0 or more, or nothing. Null when it is something else. */
function figureOf(v: unknown): number | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) return null;
  return v;
}

/** The form's fields, before the karigar is looked up. */
export function repairEditFrom(raw: unknown): Cleaned<Omit<RepairEdit, 'karigarName'>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Send the repair.' };
  const r = raw as Record<string, unknown>;

  if (!Array.isArray(r.pieces) || r.pieces.length > 50) return { ok: false, error: 'The pieces are a list of up to 50.' };
  const sent: { item?: string; work?: string; weightG?: number; price?: number }[] = [];
  for (const p of r.pieces) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: 'Each piece is what it is and what to do.' };
    const piece = p as Record<string, unknown>;
    const item = textOf(piece.item, 200);
    const work = textOf(piece.work, 500);
    const weightG = figureOf(piece.weightG);
    const price = figureOf(piece.price);
    if (item === null || work === null) return { ok: false, error: 'A piece\'s words are text.' };
    if (weightG === null || price === null) return { ok: false, error: 'A weight or price is a figure of 0 or more.' };
    sent.push({ item, work, weightG, price });
  }
  const pieces = repairPiecesFrom(sent);
  if (!pieces.length) return { ok: false, error: 'A repair needs at least one piece.' };

  const customerName = textOf(r.customerName, 120);
  const contact = textOf(r.customerContact, 40);
  const takenBy = textOf(r.takenBy, 80);
  const internalNote = textOf(r.internalNote, 2000);
  const promisedDate = textOf(r.promisedDate, 10);
  if (customerName === null) return { ok: false, error: 'The customer\'s name is text.' };
  if (contact === null) return { ok: false, error: 'The phone is text.' };
  if (takenBy === null) return { ok: false, error: 'Taken by is a name.' };
  if (internalNote === null) return { ok: false, error: 'The note is text of up to 2000 letters.' };
  if (promisedDate === null || (promisedDate && (!DAY.test(promisedDate) || Number.isNaN(new Date(promisedDate).getTime())))) {
    return { ok: false, error: 'Ready by is a day (yyyy-MM-dd).' };
  }
  const customerId = r.customerId === undefined || r.customerId === null || r.customerId === '' ? '' : idOf(r.customerId);
  if (customerId === '' && r.customerId) return { ok: false, error: 'Which customer?' };
  const karigarId = r.karigarId === undefined || r.karigarId === null || r.karigarId === '' ? '' : idOf(r.karigarId);
  if (karigarId === '' && r.karigarId) return { ok: false, error: 'Which karigar?' };

  // The phone's field takes a number as typed; the ERP keeps it as the web's phone field does.
  const phone = contact ? normalizePhoneNumber(contact) || contact : '';
  return {
    ok: true,
    value: {
      customerName,
      pieces,
      ...(customerId && { customerId }),
      ...(phone && { customerContact: phone }),
      ...(promisedDate && { promisedDate }),
      ...(karigarId && { karigarId }),
      ...(takenBy && { takenBy }),
      ...(internalNote && { internalNote }),
    },
  };
}

export const runRepairOp: OpHandler = async (op, body, ctx) => {
  const fx = { log: ctx.log };

  switch (op) {
    case 'updateRepair': {
      const repairId = idOf(body.repairId);
      if (!repairId) return bad('Which repair?');
      const cleaned = repairEditFrom(body.repair);
      if (!cleaned.ok) return bad(cleaned.error);
      const edit: RepairEdit = { ...cleaned.value };
      if (edit.karigarId) {
        const karigar = await adminPort.get<{ name?: string }>('karigars', edit.karigarId);
        if (!karigar) return bad('No such karigar.', 409);
        edit.karigarName = (karigar.name || '').trim() || edit.karigarId;
      }
      try {
        const repair = await updateRepair(adminPort, repairId, edit, { deleteField: () => FieldValue.delete() }, fx);
        return NextResponse.json({ ok: true, repair, followUps: ctx.followUps });
      } catch (e) {
        const gone = missing(e);
        if (gone) return gone;
        throw e;
      }
    }

    case 'deleteRepair': {
      const repairId = idOf(body.repairId);
      if (!repairId) return bad('Which repair?');
      if (!(await adminPort.get('repairs', repairId))) return bad('No such repair.', 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Delete repair ${repairId}`);
      if (!code.ok) return bad(code.error, code.status);
      try {
        const out = await deleteRepair(adminPort, repairId, fx);
        return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
      } catch (e) {
        const gone = missing(e);
        if (gone) return gone;
        throw e;
      }
    }
  }
  return null;
};
