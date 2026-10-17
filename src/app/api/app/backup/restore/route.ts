/**
 * Settings → Backups' "Restore" for the iPhone app (src/app/settings/backups, ImportCard).
 *
 * POST { collection, docs: { <id>: document }, deleteCode, exportedAt?, part?, parts? }: one collection's
 * slice of a backup file (up to 400 documents, the page's batch), merged into the live records as the page
 * merges them (set with merge). The phone reads the file, shows what is in it, and sends it a slice at a
 * time, so no request is bigger than one batch and each lands whole or not at all.
 *
 * A restore writes over live records, so it is the owners', it asks for the delete code on every slice (a
 * right code gives its try back, lib/delete-code-gate.ts), it holds to the collections a backup copies
 * (lib/backup-collections.ts) and it respects the owner's lock. Each slice is in the activity log.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { personFor } from '@/lib/people';
import { BACKUP_COLLECTIONS, isBackupCollection, reviveTimestamps } from '@/lib/backup-collections';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** The page's batch: one slice is one Firestore batch, under its limit of 500 writes. */
const RESTORE_CHUNK = 400;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece. */
const docId = (id: string) => id.length > 0 && id.length <= 1500 && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return bad('Sign in again.', 401);
  if (roleForEmail(email) !== 'owner') return bad('Backups are the owners’.', 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad('Bad request'); }

  const collection = body.collection;
  if (!isBackupCollection(collection)) return bad('Not a collection a backup restores.');
  if (!isObject(body.docs)) return bad('Nothing to restore.');
  const entries = Object.entries(body.docs);
  if (!entries.length) return bad('Nothing to restore.');
  if (entries.length > RESTORE_CHUNK) return bad(`Up to ${RESTORE_CHUNK} records at a time.`);
  for (const [id, d] of entries) {
    if (!docId(id)) return bad(`"${id.slice(0, 40)}" is not a record's id.`);
    if (!isObject(d)) return bad(`${id} is not a record.`);
  }

  const settings = await adminDb.collection('app_settings').doc('global').get();
  if (settings.exists && settings.data()?.databaseLocked) return bad('The database is locked. Unlock it in Settings first.', 423);

  const label = BACKUP_COLLECTIONS.find((c) => c.id === collection)?.label ?? collection;
  const code = await passDeleteCode(email, body.deleteCode, `Restore ${entries.length} ${label} from a backup`);
  if (!code.ok) return bad(code.error, code.status);

  const batch = adminDb.batch();
  // The file's dates (`{ seconds, nanoseconds }`, backupReplacer) go back as dates, not as plain maps.
  for (const [id, d] of entries) batch.set(adminDb.collection(collection).doc(id), reviveTimestamps(d, (sec, ns) => new Timestamp(sec, ns)) as Record<string, unknown>, { merge: true });
  await batch.commit();

  const exportedAt = typeof body.exportedAt === 'string' ? body.exportedAt.slice(0, 40) : '';
  const part = Number(body.part), parts = Number(body.parts);
  const of = Number.isInteger(part) && Number.isInteger(parts) && part > 0 && parts >= part ? ` · part ${part} of ${parts}` : '';
  try {
    await adminDb.collection('activity_log').add({
      action: 'backup.restore',
      title: `Restored ${entries.length} ${label} from a backup`,
      detail: `${exportedAt ? `Backup of ${exportedAt}` : 'A backup file'}${of} · by ${personFor(email) || email}`,
      relatedId: collection, by: email, at: new Date().toISOString(), via: 'iphone-app',
    });
  } catch (e) { console.error('[/api/app/backup/restore] activity log', e); }

  return NextResponse.json({ ok: true, collection, written: entries.length });
}
