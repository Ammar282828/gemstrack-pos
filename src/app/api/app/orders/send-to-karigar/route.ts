/**
 * POST → send an order's pieces to a karigar on WhatsApp, from the shop's line (lib/whatsapp.ts):
 * the owner, 2026-11-02 — "send order details to a karigar … the description, picture, weight, any
 * instructions … from the order page or the workshop page".
 *
 *   { orderId, pieceIndexes?: number[], karigarId?: string, phone?: string }
 *
 * Owners and staff. Per karigar: each chosen piece's reference photos as images (the first of a piece
 * captioned with its details), then one text with the order number, due date and every piece in the
 * slip's own words (lib/karigar-message.ts). Never a price and never the customer beyond a first name,
 * so the slip PDF is NOT sent: it prints the estimate and the balance.
 *
 * Without `karigarId`, each piece goes to its assigned karigar (pieces nobody holds are refused);
 * with it, `pieceIndexes` defaults to the pieces assigned to him, else all. `phone` replaces the
 * number on file (one karigar only). `preview: true` returns the words (and photo count) without sending. One photo failing does not stop the rest.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { pdfViewer, isDocId } from '@/lib/app-pdf';
import { staffView } from '@/lib/staff-view';
import { itemPhotoRefs } from '@/lib/order-photos';
import { readOrderPhotos } from '@/lib/order-photos-server';
import { sendWhatsAppFile, sendWhatsAppMessage, toWhatsAppNumber, whatsAppProvider } from '@/lib/whatsapp';
import { buildKarigarMessage, buildPhotoCaption, chooseKarigarPieces, maskPhone } from '@/lib/karigar-message';
import { STORE_CONFIG } from '@/lib/store-config';
import { dailyCap, WHATSAPP_PER_DAY } from '@/lib/daily-cap';
import type { Order } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A photo as a Blob: a data URI, or a URL the server can fetch; null when it is neither. */
async function photoBlob(src: string): Promise<{ blob: Blob; name: string } | null> {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(src);
  if (m) {
    const type = m[1] || 'image/jpeg';
    const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    if (!bytes.length) return null;
    return { blob: new Blob([new Uint8Array(bytes)], { type }), name: `photo.${type.includes('png') ? 'png' : 'jpg'}` };
  }
  if (/^https:\/\//.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    return { blob: new Blob([await res.arrayBuffer()], { type }), name: `photo.${type.includes('png') ? 'png' : 'jpg'}` };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => ({}))) as { orderId?: unknown; pieceIndexes?: unknown; karigarId?: unknown; phone?: unknown; preview?: unknown };
  const preview = body.preview === true;
  if (!preview) {
    const capped = await dailyCap('whatsapp', who.email, req, WHATSAPP_PER_DAY);
    if (capped) return capped;
  }
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const karigarId = typeof body.karigarId === 'string' ? body.karigarId.trim() : '';
  const phoneOverride = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (!isDocId(orderId)) return bad('Say which order.');
  if (karigarId && !isDocId(karigarId)) return bad('Say which karigar.');
  const asked = Array.isArray(body.pieceIndexes) ? body.pieceIndexes.filter((n): n is number => typeof n === 'number') : null;
  if (!preview && !whatsAppProvider()) return bad("This shop's WhatsApp line isn't connected to the ERP.", 503);

  try {
    const snap = await adminDb.collection('orders').doc(orderId).get();
    if (!snap.exists) return bad(`No order ${orderId}. It may have been deleted.`, 404);
    const raw = { ...(snap.data() as Record<string, unknown>), id: snap.id };
    const order = (who.role === 'owner' ? raw : staffView('orders', raw)) as unknown as Order;
    if (!Array.isArray(order.items) || !order.items.length) return bad('That order has no pieces.');

    // Who gets which pieces.
    const groups = new Map<string, number[]>();
    if (karigarId) {
      const mine = order.items.map((it, i) => (it.karigarId === karigarId ? i : -1)).filter(i => i >= 0);
      const chosen = chooseKarigarPieces(order, asked?.length ? asked : mine.length ? mine : null);
      if (!chosen.length) return bad('Pick at least one piece.');
      groups.set(karigarId, chosen);
    } else {
      for (const i of chooseKarigarPieces(order, asked)) {
        const k = order.items[i].karigarId;
        if (!k) continue;
        groups.set(k, [...(groups.get(k) ?? []), i]);
      }
      if (!groups.size) return bad('Pick a karigar first. None of those pieces is assigned to one.');
    }
    if (phoneOverride && groups.size > 1) return bad('A phone number can only replace one karigar’s. Pick the karigar.');

    const shopName = String((await adminDb.doc('app_settings/global').get().catch(() => null))?.get('shopName') || '').trim() || STORE_CONFIG.name;

    // The words, without sending: the phone shows them (and shares them) from the one builder, here.
    if (preview) {
      const messages = [];
      for (const [id, indexes] of groups) {
        const k = await adminDb.collection('karigars').doc(id).get();
        const name = String(k.get('name') || '');
        messages.push({
          karigarId: id, pieces: indexes, message: buildKarigarMessage(order, indexes, { karigarName: name, shopName }),
          photos: indexes.reduce((n, i) => n + itemPhotoRefs(order.items[i]).length, 0),
        });
      }
      return NextResponse.json({ ok: true, preview: true, messages, message: messages[0]?.message ?? '' });
    }

    // Everyone's number is checked before anything is sent.
    const people = new Map<string, { name: string; to: string }>();
    for (const id of groups.keys()) {
      const k = await adminDb.collection('karigars').doc(id).get();
      if (!k.exists || k.get('deletedAt')) return bad('That karigar is not on file any more.', 409);
      const name = String(k.get('name') || 'the karigar');
      const to = toWhatsAppNumber(phoneOverride || String(k.get('contact') || '') || String(k.get('altPhone') || ''));
      if (to.length < 11 || to.length > 15) return bad(`Add a phone number for ${name} first.`);
      people.set(id, { name, to });
    }

    let sent = 0;
    const failedPhotos: string[] = [];

    for (const [id, indexes] of groups) {
      const { name, to } = people.get(id)!;
      // The photo documents, one round trip.
      const refs = indexes.map(i => itemPhotoRefs(order.items[i]));
      const docs = await readOrderPhotos(adminDb, refs.flat().map(r => r.id || ''));
      let photoCount = 0;
      /** Pieces whose details went with a photo: the text after is only for the ones that had none. */
      const captioned = new Set<number>();
      for (let n = 0; n < indexes.length; n++) {
        // The piece's details ride on its first photo (owner, 2026-11-03: "make the message very simple"): one
        // message per piece, never the same details again in a text after it.
        const caption = buildPhotoCaption(order, indexes[n], `Order ${order.id}`);
        let first = true;
        for (const r of refs[n]) {
          try {
            const src = r.src || docs.get(r.id || '') || '';
            const p = src ? await photoBlob(src) : null;
            if (!p) { failedPhotos.push(`${order.id} piece ${indexes[n] + 1}`); continue; }
            await sendWhatsAppFile(to, p.blob, p.name, first ? caption : '');
            if (first) captioned.add(indexes[n]);
            first = false;
            photoCount++;
            sent++;
          } catch (e) {
            console.warn('[send-to-karigar] a photo did not go', order.id, e);
            failedPhotos.push(`${order.id} piece ${indexes[n] + 1}`);
          }
        }
      }
      // Only the pieces without a photo still need their words sent.
      const uncaptioned = indexes.filter(i => !captioned.has(i));
      if (uncaptioned.length) {
        await sendWhatsAppMessage(to, buildKarigarMessage(order, uncaptioned, { karigarName: name, shopName, photoCount }));
        sent++;
      }
      try {
        await adminDb.collection('activity_log').add({
          action: 'order.update', title: `Sent order ${order.id} to ${name}`, detail: `${indexes.length} piece(s), ${photoCount} photo(s) · WhatsApp`,
          relatedId: order.id, by: who.email, at: new Date().toISOString(), via: 'send-to-karigar',
        });
      } catch (e) { console.warn('[send-to-karigar] activity log', e); }
    }

    return NextResponse.json({
      ok: true, sent, to: [...people.values()].map(p => maskPhone(p.to)).join(', '),
      ...(failedPhotos.length ? { photosFailed: failedPhotos.length } : {}),
    });
  } catch (e) {
    console.error('[/api/app/orders/send-to-karigar]', orderId, e);
    return bad(e instanceof Error && /WhatsApp|WAHA|Green/i.test(e.message) ? `WhatsApp did not take it: ${e.message.slice(0, 160)}` : 'Could not send. Try again.', 502);
  }
}
