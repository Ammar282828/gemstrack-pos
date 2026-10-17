/**
 * GET → the WhatsApp reminder of what a customer owes, for the iPhone app's ledger (the web writes the same
 * words in the browser: lib/hisaab-report.ts reminderMessage). Owners only, as the ledger is.
 *   → { due, name, phone, message, url }   message/url empty when nothing is owed or there is no usable number
 * `?phone=` uses that number instead of the one on the customer's record, as the web's dialog lets one type it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { isDocId } from '@/lib/app-pdf';
import { pdfOwner } from '@/lib/app-pdf-owner';
import { hisaabLedger, reminderMessage } from '@/lib/hisaab-report';
import { normalizePhoneNumber } from '@/lib/utils';
import { whatsAppLink } from '@/lib/whatsapp';
import { STORE_CONFIG } from '@/lib/store-config';
import type { HisaabEntry } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfOwner(req, 'The hisaab');
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!isDocId(id)) return NextResponse.json({ error: 'No such customer.' }, { status: 404 });
  try {
    const [rows, rec, settings] = await Promise.all([
      adminDb.collection('hisaab').where('entityId', '==', id).get(),
      adminDb.collection('customers').doc(id).get(),
      adminDb.doc('app_settings/global').get().catch(() => null),
    ]);
    const entries = rows.docs.map(d => ({ ...(d.data() as Record<string, unknown>), id: d.id }) as HisaabEntry);
    const name = String((rec.exists ? rec.data()?.name : '') || entries[0]?.entityName || '').trim();
    if (!name && !entries.length) return NextResponse.json({ error: 'No such customer.' }, { status: 404 });
    const due = hisaabLedger(entries, id).finalCashBalance;
    const shopName = String(settings?.get('shopName') || '').trim() || STORE_CONFIG.name;
    const typed = req.nextUrl.searchParams.get('phone');
    const phone = normalizePhoneNumber(typed || (rec.exists ? String(rec.data()?.phone || '') : ''));
    const message = reminderMessage(name, shopName, due) ?? '';
    return NextResponse.json({ due, name, phone, message, url: message && phone ? whatsAppLink(phone, message) : '' });
  } catch (e) {
    console.error('[/api/app/hisaab/[id]/reminder]', id, e);
    return NextResponse.json({ error: 'The reminder could not be written.' }, { status: 500 });
  }
}
