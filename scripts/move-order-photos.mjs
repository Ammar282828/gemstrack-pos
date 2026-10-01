#!/usr/bin/env node
/**
 * Move the sample photos that still sit inside order documents to `order_photos/<id>` and leave
 * each item a `samplePhotoId` (lib/order-photos.ts; 2026-10-01, "why is every update so slow").
 *
 *   node scripts/move-order-photos.mjs <project-id>          # dry run: what would move
 *   node scripts/move-order-photos.mjs <project-id> --apply  # move, then check every one
 *
 * Google credentials from the machine (applicationDefault: a cloud session's key, or
 * `gcloud auth application-default login`). One transaction per order, which re-reads the order,
 * so an edit made meanwhile is never overwritten. The photo is copied before the order stops
 * carrying it, and the check afterwards reads every photo back and compares its length.
 * Prints counts and sizes, never a photo. Safe to run twice: a moved order has nothing inline.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const [project, flag] = process.argv.slice(2);
if (!project) { console.error('usage: node scripts/move-order-photos.mjs <project-id> [--apply]'); process.exit(1); }
const apply = flag === '--apply';

initializeApp({ credential: applicationDefault(), projectId: project });
const db = getFirestore();
const isInline = v => typeof v === 'string' && v.startsWith('data:');
const newId = () => `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const kb = n => `${(n / 1024).toFixed(0)} KB`;

const snap = await db.collection('orders').get();
const todo = snap.docs.filter(d => (d.get('items') || []).some(it => isInline(it?.sampleImageDataUri)));
let photos = 0, bytes = 0;
for (const d of todo) for (const it of d.get('items')) if (isInline(it?.sampleImageDataUri)) { photos++; bytes += it.sampleImageDataUri.length; }
console.log(`${project}: ${snap.size} orders, ${todo.length} carry ${photos} photos inline (${kb(bytes)}).`);
if (!apply) { console.log('Dry run. Add --apply to move them.'); process.exit(0); }

const moved = []; // [orderId, itemIndex, photoId, length]
for (const d of todo) {
  await db.runTransaction(async tx => {
    const fresh = await tx.get(d.ref);
    const items = fresh.get('items') || [];
    const createdAt = new Date().toISOString();
    const next = items.map((it, i) => {
      if (!isInline(it?.sampleImageDataUri)) return it;
      const id = newId();
      tx.set(db.collection('order_photos').doc(id), { dataUri: it.sampleImageDataUri, orderId: d.id, createdAt });
      moved.push([d.id, i, id, it.sampleImageDataUri.length]);
      const { sampleImageDataUri: _moved, ...rest } = it;
      return { ...rest, samplePhotoId: id };
    });
    tx.update(d.ref, { items: next });
  });
  console.log(`  ${d.id}: moved`);
}

// The check: every moved photo is in its document at its full length, and its order points at it.
let ok = 0;
const bad = [];
for (const [orderId, i, id, len] of moved) {
  const [photo, order] = await Promise.all([db.collection('order_photos').doc(id).get(), db.collection('orders').doc(orderId).get()]);
  const item = (order.get('items') || [])[i];
  if (photo.exists && String(photo.get('dataUri')).length === len && item?.samplePhotoId === id && !item?.sampleImageDataUri) ok++;
  else bad.push(`${orderId}#${i}`);
}
const after = (await db.collection('orders').get()).docs.reduce((n, d) => n + JSON.stringify(d.data()).length, 0);
console.log(`Checked ${moved.length}: ${ok} right${bad.length ? `, WRONG: ${bad.join(', ')}` : ''}. Orders now ${kb(after)} in all.`);
process.exit(bad.length ? 2 : 0);
