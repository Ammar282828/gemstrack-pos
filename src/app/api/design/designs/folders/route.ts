/**
 * Folders of designs and saved ads (the shared `ad_folders`): POST { name } · PATCH { id, name } ·
 * DELETE ?id= (what was inside stays, unfiled).
 */

import { NextRequest, NextResponse } from 'next/server';
import { designFail, designGate, noStore } from '@/lib/design/gate';
import { ID_OK } from '@/lib/design/model';
import { createFolder, deleteFolder, renameFolder } from '@/lib/design/store';

export const dynamic = 'force-dynamic';
const idOk = (id: unknown): id is string => typeof id === 'string' && ID_OK.test(id);

export async function POST(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as { name?: string };
    return NextResponse.json({ folder: await createFolder(String(b.name ?? '')) }, { headers: noStore });
  } catch (e) { return designFail(e, 'folders'); }
}

export async function PATCH(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as { id?: string; name?: string };
    if (!idOk(b.id)) return NextResponse.json({ error: 'Which folder?' }, { status: 400 });
    await renameFolder(b.id, String(b.name ?? ''));
    return NextResponse.json({ ok: true });
  } catch (e) { return designFail(e, 'folders'); }
}

export async function DELETE(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id');
  if (!idOk(id)) return NextResponse.json({ error: 'Which folder?' }, { status: 400 });
  try { await deleteFolder(id); return NextResponse.json({ ok: true }); }
  catch (e) { return designFail(e, 'folders'); }
}
