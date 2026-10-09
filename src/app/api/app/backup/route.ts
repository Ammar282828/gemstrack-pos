/**
 * Settings → Backups' "Download Backup" for the iPhone app (src/app/settings/backups, ExportCard).
 *
 * - GET: what can be copied out (lib/backup-collections.ts), each with how many records it holds now, and
 *   the file's name in the page's form. The page reads every document to count them; this asks Firestore to
 *   count, which is the same number without the reading.
 * - GET `?collection=<id>`: that collection's documents as the page writes them into the file,
 *   `{ <id>: document }`. The phone asks one collection at a time, as the page reads them, so no answer holds
 *   more than the biggest collection, and puts the file together itself in the page's format.
 *
 * Owners only: it is the whole of the books. Read-only. The page's Restore (a file merged into every
 * collection it names) is not here: it stays the ERP's page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { BACKUP_COLLECTIONS, backupFileName, backupReplacer, isBackupCollection } from '@/lib/backup-collections';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return bad('Sign in again.', 401);
  if (roleForEmail(email) !== 'owner') return bad('Backups are the owners’.', 403);

  const name = req.nextUrl.searchParams.get('collection');
  if (name !== null) {
    if (!isBackupCollection(name)) return bad('Not a collection the backup copies.');
    const snap = await adminDb.collection(name).get();
    const docs: Record<string, unknown> = {};
    snap.forEach((d) => { docs[d.id] = d.data(); });
    return new NextResponse(JSON.stringify(docs, backupReplacer), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const [counts, settings] = await Promise.all([
    Promise.all(BACKUP_COLLECTIONS.map(async (c) => {
      try {
        return (await adminDb.collection(c.id).count().get()).data().count;
      } catch {
        // The page shows "err" for a collection it could not read.
        return -1;
      }
    })),
    adminDb.collection('app_settings').doc('global').get(),
  ]);
  const shopName = (settings.data() as { shopName?: unknown } | undefined)?.shopName;
  return NextResponse.json({
    collections: BACKUP_COLLECTIONS.map((c, i) => ({ ...c, count: counts[i] })),
    fileName: backupFileName(typeof shopName === 'string' ? shopName : undefined),
  });
}
