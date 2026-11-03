/**
 * POST → send an order's pieces to a karigar on WhatsApp, from the shop's line (lib/whatsapp.ts):
 * the owner, 2026-11-02 — "send order details to a karigar … the description, picture, weight, any
 * instructions … from the order page or the workshop page".
 *
 *   { orderId, pieceIndexes?: number[], karigarId?: string, phone?: string, texts?: { [pieceIndex]: string } }
 *
 * Owners and staff. Per karigar: each chosen piece's reference photos as images (the first of a piece
 * captioned with its details), then one text with the order number, due date and every piece in the
 * slip's own words (lib/karigar-message.ts). Never a price and never the customer beyond a first name,
 * so the slip PDF is NOT sent: it prints the estimate and the balance.
 *
 * Without `karigarId`, each piece goes to its assigned karigar (pieces nobody holds are refused);
 * with it, `pieceIndexes` defaults to the pieces assigned to him, else all. `phone` replaces the
 * number on file (one karigar only). `preview: true` returns the words per piece (and photo count) without sending.
 * `texts` replaces a piece's words (its photo caption, or its text when it has no photo); "" sends the photo bare. A piece's words only ever
 * go to that piece's own karigar. One photo failing does not stop the rest.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { pdfViewer, isDocId } from '@/lib/app-pdf';
import { staffView } from '@/lib/staff-view';
import { itemPhotoRefs } from '@/lib/order-photos';
import { readOrderPhotos } from '@/lib/order-photos-server';
import { sendWhatsAppFile, sendWhatsAppMessage, toWhatsAppNumber, whatsAppProvider } from '@/lib/whatsapp';
import { buildKarigarMessage, chooseKarigarPieces, maskPhone, parseTextOverrides, pieceMessages, KARIGAR_CAPTION_MAX, KARIGAR_TEXT_MAX } from '@/lib/karigar-message';
import { STORE_CONFIG } from '@/lib/store-config';
import { dailyCap, WHATSAPP_PER_DAY } from '@/lib/daily-cap';
import type { Order } from '@/lib/store';
import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** A request stops starting new messages after this long and answers `partial`: the caller asks again and it carries on. */
const BUDGET_MS = 40_000;
/** A send another request is in the middle of (its last message under this long ago) is not started twice. */
const BUSY_MS = 90_000;
/** The same send finished this recently is not sent again: a double tap, two devices, a Retry after it went. */
const AGAIN_MS = 120_000;
/** An unfinished send this recent carries on where it stopped instead of starting over. */
const RESUME_MS = 30 * 60_000;

/** A timeout from WhatsApp is not a refusal: the message may well have gone, so it is never sent again. */
const maybeWent = (e: unknown) => e instanceof Error && /TimeoutError|AbortError|aborted|timed? ?out/i.test(`${e.name} ${e.message}`);

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
  const body = (await req.json().catch(() => ({}))) as { orderId?: unknown; pieceIndexes?: unknown; karigarId?: unknown; phone?: unknown; preview?: unknown; texts?: unknown };
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
  const overrides = parseTextOverrides(body.texts);
  if (overrides === null) return bad('The edited words are not in the right shape.');
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
        const pieces = pieceMessages(order, indexes).map(p => ({ ...p, photos: itemPhotoRefs(order.items[p.index]).length }));
        messages.push({
          karigarId: id, pieces, message: pieces.map(p => p.text).join('\n\n'),
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

    // One record per send (owner, 2026-11-03: "it keeps retrying or double sending"): the same order, pieces,
    // karigar and words asked for again — a double tap, a second device, a Retry after a timeout, a phone's request
    // replayed — never reaches WhatsApp twice. Each message is ticked off as it goes, so an unfinished send carries
    // on from where it stopped and what went is never repeated.
    const key = createHash('sha256').update(JSON.stringify({
      orderId, groups: [...groups].map(([id, ix]) => [id, people.get(id)!.to, ix]),
      texts: overrides ? [...overrides].sort((a, b) => a[0] - b[0]) : null,
    })).digest('hex').slice(0, 40);
    const ref = adminDb.collection('karigar_sends').doc(key);
    const names = [...people.values()].map(p => p.name).join(', ');
    const toSaid = [...people.values()].map(p => maskPhone(p.to)).join(', ');
    const started = Date.now();
    const claim = await adminDb.runTransaction(async tx => {
      const d = (await tx.get(ref)).data() as { state?: string; startedAt?: number; beatAt?: number; finishedAt?: number; done?: string[]; sent?: number } | undefined;
      const now = Date.now();
      if (d?.state === 'sending' && now - (d.beatAt ?? 0) < BUSY_MS) return { busy: true as const };
      if (d?.state === 'done' && now - (d.finishedAt ?? 0) < AGAIN_MS) return { already: d.sent ?? 0, ago: now - (d.finishedAt ?? now) };
      if (d && d.state !== 'done' && now - (d.startedAt ?? 0) < RESUME_MS) {
        tx.update(ref, { state: 'sending', beatAt: now });
        return { done: new Set(d.done ?? []), sentBefore: d.sent ?? 0 };
      }
      tx.set(ref, { state: 'sending', orderId, by: who.email, startedAt: now, beatAt: now, done: [], sent: 0 });
      return { done: new Set<string>(), sentBefore: 0 };
    });
    if ('busy' in claim) {
      return NextResponse.json({ ok: true, duplicate: true, busy: true, sent: 0, to: toSaid, said: `Already sending to ${names}. It will say when it has gone.` });
    }
    if ('already' in claim) {
      const s = Math.max(1, Math.round((claim.ago ?? 0) / 1000));
      return NextResponse.json({ ok: true, duplicate: true, sent: claim.already, to: toSaid, said: `Already sent to ${names} ${s < 60 ? `${s} s` : `${Math.round(s / 60)} min`} ago.` });
    }
    const done = claim.done;
    let partial = false;
    let unsure = 0;
    /** Sends one message once: skipped when an earlier request already sent it, and ticked off the moment it goes. */
    const once = async (tick: string, send: () => Promise<unknown>): Promise<'sent' | 'skipped' | 'later'> => {
      if (done.has(tick)) return 'skipped';
      if (Date.now() - started > BUDGET_MS) { partial = true; return 'later'; }
      try {
        await send();
      } catch (e) {
        if (!maybeWent(e)) throw e;
        unsure++;
        console.warn('[send-to-karigar] WhatsApp timed out; not sending it again', order.id, tick);
      }
      done.add(tick);
      await ref.update({ done: FieldValue.arrayUnion(tick), sent: FieldValue.increment(1), beatAt: Date.now() }).catch(e => console.warn('[send-to-karigar] tick', e));
      return 'sent';
    };

    let sent = 0;
    const failedPhotos: string[] = [];

    try {
    for (const [id, indexes] of groups) {
      const { name, to } = people.get(id)!;
      // The photo documents, one round trip.
      const refs = indexes.map(i => itemPhotoRefs(order.items[i]));
      const docs = await readOrderPhotos(adminDb, refs.flat().map(r => r.id || ''));
      let photoCount = 0;
      /** Pieces whose details went with a photo: the text after is only for the ones that had none. */
      const captioned = new Set<number>();
      for (let n = 0; n < indexes.length && !partial; n++) {
        // The piece's details ride on its first photo (owner, 2026-11-03: "make the message very simple"): one
        // message per piece, never the same details again in a text after it.
        const edited = overrides?.get(indexes[n]);
        const caption = edited !== undefined ? edited.slice(0, KARIGAR_CAPTION_MAX) : pieceMessages(order, [indexes[n]])[0].text;
        // A photo of this piece that went in an earlier request carried its words: a retried one goes bare.
        const tickOf = (j: number) => `${id}:${indexes[n]}:p${j}`;
        let first = !refs[n].some((_, j) => done.has(tickOf(j)));
        if (!first) captioned.add(indexes[n]);
        for (let j = 0; j < refs[n].length; j++) {
          const r = refs[n][j];
          const tick = tickOf(j);
          try {
            if (done.has(tick)) { photoCount++; continue; }
            const src = r.src || docs.get(r.id || '') || '';
            const p = src ? await photoBlob(src) : null;
            if (!p) { failedPhotos.push(`${order.id} piece ${indexes[n] + 1}`); continue; }
            const how = await once(tick, () => sendWhatsAppFile(to, p.blob, p.name, first ? caption : ''));
            if (how === 'later') break;
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
      // Edited ones are sent as the owner wrote them (nothing when emptied); the rest as one generated message.
      const untouched = uncaptioned.filter(i => !overrides?.has(i));
      if (partial) break;
      for (const i of uncaptioned.filter(i => overrides?.has(i))) {
        const words = (overrides!.get(i) || '').slice(0, KARIGAR_TEXT_MAX);
        if (!words) continue;
        if (await once(`${id}:${i}:text`, () => sendWhatsAppMessage(to, words)) === 'sent') sent++;
      }
      if (untouched.length) {
        const words = buildKarigarMessage(order, untouched, { karigarName: name, shopName, photoCount });
        if (await once(`${id}:text:${untouched.join(',')}`, () => sendWhatsAppMessage(to, words)) === 'sent') sent++;
      }
      if (partial) break;
      // Once per send, when this karigar's part has all gone (a carry-on does not log it twice).
      if (!done.has(`${id}:logged`)) try {
        done.add(`${id}:logged`);
        await ref.update({ done: FieldValue.arrayUnion(`${id}:logged`) });
        await adminDb.collection('activity_log').add({
          action: 'order.update', title: `Sent order ${order.id} to ${name}`, detail: `${indexes.length} piece(s), ${photoCount} photo(s) · WhatsApp`,
          relatedId: order.id, by: who.email, at: new Date().toISOString(), via: 'send-to-karigar',
        });
      } catch (e) { console.warn('[send-to-karigar] activity log', e); }
    }

    } catch (e) {
      // Let the next request carry on from what went, straight away.
      await ref.update({ state: 'failed', beatAt: 0 }).catch(() => {});
      throw e;
    }

    // A photo that could not be read or was refused stays unticked: Retry sends only those.
    if (partial || failedPhotos.length) await ref.update({ state: partial ? 'paused' : 'incomplete', beatAt: 0 }).catch(() => {});
    else await ref.update({ state: 'done', finishedAt: Date.now() }).catch(() => {});

    return NextResponse.json({
      ok: true, sent, to: toSaid,
      ...(partial ? { partial: true } : {}),
      ...(claim.sentBefore ? { sentBefore: claim.sentBefore } : {}),
      ...(unsure ? { unsure } : {}),
      ...(failedPhotos.length ? { photosFailed: failedPhotos.length } : {}),
    });
  } catch (e) {
    console.error('[/api/app/orders/send-to-karigar]', orderId, e);
    return bad(e instanceof Error && /WhatsApp|WAHA|Green/i.test(e.message) ? `WhatsApp did not take it: ${e.message.slice(0, 160)}` : 'Could not send. Try again.', 502);
  }
}
