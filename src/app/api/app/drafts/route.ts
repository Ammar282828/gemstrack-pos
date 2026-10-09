/**
 * The iPhone app's unfinished order and sale, in Drafts (Firestore `drafts`) beside the browser's, so one
 * begun on a phone is finished at the counter (decisions.md "Drafts"; apps/iphone App/Data/WorkDraftSync.swift).
 *
 * POST { action: 'save', id, kind, data, total, customerName, device, createdAt }: the draft as the web's form
 *   holds it (the phone builds it in that shape: NewOrderWebDraft, SaleWebDraft), its card worked out here.
 * POST { action: 'drop', id }: the order or sale was saved, or started over.
 * POST { action: 'check', id }: is it still there? One finished or thrown away at the counter is gone, and the
 *   phone lets go of its own copy rather than save it a second time.
 *
 * Not /api/app/write: a draft is not the books. It is written a second after each change, so it claims no
 * request id and leaves no activity log, as the browser's drafts don't. Owners and staff, who take orders and
 * sales; the server writes, so it works for staff too, who have no Firestore of their own.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { DRAFT_ID_RE, draftWrite } from '@/lib/work-drafts';

export const dynamic = 'force-dynamic';

const COLL = 'drafts';

export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Not yours to change.' }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const id = typeof body.id === 'string' ? body.id : '';

  try {
    switch (body.action) {
      case 'save': {
        const w = draftWrite(body);
        if (!w.ok) return NextResponse.json({ error: w.error }, { status: 400 });
        await adminDb.collection(COLL).doc(w.id).set(w.doc);
        return NextResponse.json({ ok: true, id: w.id });
      }
      case 'drop': {
        if (!DRAFT_ID_RE.test(id)) return NextResponse.json({ error: 'Not a draft.' }, { status: 400 });
        await adminDb.collection(COLL).doc(id).delete();
        return NextResponse.json({ ok: true });
      }
      case 'check': {
        if (!DRAFT_ID_RE.test(id)) return NextResponse.json({ error: 'Not a draft.' }, { status: 400 });
        const snap = await adminDb.collection(COLL).doc(id).get();
        return NextResponse.json({ ok: true, exists: snap.exists });
      }
      default:
        return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
  } catch (e) {
    console.error('[/api/app/drafts]', e);
    return NextResponse.json({ error: 'The draft could not be kept. It is still on the phone.' }, { status: 500 });
  }
}
