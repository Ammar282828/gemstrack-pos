/**
 * The old Taheri Software book for Settings → Import (the page used to import it as a JSON file, which put the
 * customers into a public script). Owners only, the same gate as the settings write. 404 where a house has none.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { loadTaheriBook } from '@/lib/import/taheri-book-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: 'The book is the owners’.' }, { status: 403 });
  const book = await loadTaheriBook();
  if (!book) return NextResponse.json({ error: 'No book' }, { status: 404 });
  return NextResponse.json(book, { headers: { 'Cache-Control': 'no-store' } });
}
