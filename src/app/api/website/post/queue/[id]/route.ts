/**
 * One queued piece.
 *
 *   POST    multipart { key, file } → one of a draft's images ("site-0", "wa-1", "story")
 *   PATCH   { action: 'ready' | 'hold' } or { action: 'schedule', dueAt } → the counter's say
 *   DELETE  → out of the queue (with its images)
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate } from '@/lib/social/gate';
import { changeItem, deleteItem, putMedia, toView } from '@/lib/social/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;
const idOk = (id: string) => /^[A-Za-z0-9]{10,40}$/.test(id);
const statusOf = (e: unknown) => (typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 500);
const fail = (e: unknown) => NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: statusOf(e) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!idOk(id)) return NextResponse.json({ error: 'No such piece.' }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const key = String(form?.get('key') || '');
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No image was received.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That image is over 12 MB.' }, { status: 413 });
  if (!/^image\/jpeg$/i.test(file.type)) return NextResponse.json({ error: 'Send a JPEG.' }, { status: 415 });
  try { await putMedia(id, key, Buffer.from(await file.arrayBuffer())); return NextResponse.json({ ok: true }); }
  catch (e) { return fail(e); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!idOk(id)) return NextResponse.json({ error: 'No such piece.' }, { status: 404 });
  const b = await req.json().catch(() => null) as { action?: string; dueAt?: string } | null;
  const change = b?.action === 'ready' ? { action: 'ready' as const }
    : b?.action === 'hold' ? { action: 'hold' as const }
    : b?.action === 'schedule' && typeof b.dueAt === 'string' ? { action: 'schedule' as const, dueAt: b.dueAt }
    : null;
  if (!change) return NextResponse.json({ error: 'action must be ready, hold, or schedule with dueAt.' }, { status: 400 });
  try { return NextResponse.json({ item: toView(await changeItem(id, change)) }); }
  catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!idOk(id)) return NextResponse.json({ error: 'No such piece.' }, { status: 404 });
  try { await deleteItem(id); return NextResponse.json({ ok: true }); }
  catch (e) { return fail(e); }
}
