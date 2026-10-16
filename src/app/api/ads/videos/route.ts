/**
 * A video for a new ad, into this house's Meta ad account's video library, sent in pieces
 * (Meta's resumable upload) so a video of any size passes under the server's request limit.
 *
 * POST json { phase: 'start', size }                     → { session, videoId, start, end }
 * POST multipart { phase: 'transfer', session, start, chunk } → { start, end }   (repeat until start == end)
 * POST json { phase: 'finish', session, name }           → { ok }
 * GET  ?id=<videoId>                                     → { status: 'processing' | 'ready' | 'error', progress, thumb, thumbHash }
 *
 * Once Meta has processed the video, its preferred cover frame is put in the image library too:
 * a video ad needs a cover picture, and Meta's own CDN links are not meant for creatives.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { adsFail, adsGate } from '@/lib/ads/gate';
import { graph, graphUpload, MetaAdsError } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_VIDEO = 1024 * 1024 * 1024;
const MAX_CHUNK = 28 * 1024 * 1024;

const num = (v: unknown) => Number(v ?? 0);

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const { act } = await requireAccount();
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      const b = (await req.json().catch(() => ({}))) as { phase?: string; size?: number; session?: string; name?: string };
      if (b.phase === 'start') {
        if (!(Number(b.size) > 0)) return NextResponse.json({ error: 'No video was chosen.' }, { status: 400 });
        if (Number(b.size) > MAX_VIDEO) return NextResponse.json({ error: 'That video is over 1 GB; export it smaller.' }, { status: 413 });
        const d = await graphUpload<{ upload_session_id: string; video_id: string; start_offset: string; end_offset: string }>(`${act}/advideos`, { upload_phase: 'start', file_size: String(Math.round(Number(b.size))) }, { video: true, timeoutMs: 30_000 });
        return NextResponse.json({ session: d.upload_session_id, videoId: d.video_id, start: num(d.start_offset), end: num(d.end_offset) });
      }
      if (b.phase === 'finish') {
        if (!b.session) return NextResponse.json({ error: 'No upload to finish.' }, { status: 400 });
        const title = (b.name || 'Video').slice(0, 250);
        const d = await graphUpload<{ success?: boolean }>(`${act}/advideos`, { upload_phase: 'finish', upload_session_id: b.session, title, name: title }, { video: true, timeoutMs: 60_000 });
        if (!d.success) throw new MetaAdsError('Meta didn’t confirm the video.', 502);
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: 'Unknown step.' }, { status: 400 });
    }
    const form = await req.formData().catch(() => null);
    const session = form?.get('session'), start = form?.get('start'), chunk = form?.get('chunk');
    if (typeof session !== 'string' || typeof start !== 'string' || !(chunk instanceof Blob)) return NextResponse.json({ error: 'A piece of the video went missing; try again.' }, { status: 400 });
    if (chunk.size > MAX_CHUNK) return NextResponse.json({ error: 'That piece is too large.' }, { status: 413 });
    const d = await graphUpload<{ start_offset: string; end_offset: string }>(`${act}/advideos`, { upload_phase: 'transfer', upload_session_id: session, start_offset: start, video_file_chunk: chunk }, { video: true, timeoutMs: 110_000 });
    return NextResponse.json({ start: num(d.start_offset), end: num(d.end_offset) });
  } catch (e) {
    return adsFail(e, 'video');
  }
}

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'No such video.' }, { status: 400 });
  try {
    const { act } = await requireAccount();
    const v = await graph<{ status?: { video_status?: string; processing_progress?: number } }>(id, { params: { fields: 'status' } });
    const s = v.status?.video_status ?? 'processing';
    if (s !== 'ready') return NextResponse.json({ status: s === 'processing' || s === 'uploading' ? 'processing' : 'error', progress: v.status?.processing_progress ?? null, thumb: null, thumbHash: null, detail: s });
    const t = await graph<{ data?: { uri?: string; is_preferred?: boolean }[] }>(`${id}/thumbnails`, { params: { fields: 'uri,is_preferred' } });
    const pick = t.data?.find(x => x.is_preferred) ?? t.data?.[0];
    if (!pick?.uri) return NextResponse.json({ status: 'processing', progress: null, thumb: null, thumbHash: null });
    const res = await fetch(pick.uri, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) throw new MetaAdsError('Couldn’t fetch the video’s cover frame from Meta.', 502);
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).jpeg({ quality: 92 }).toBuffer();
    const d = await graph<{ images?: Record<string, { hash: string; url?: string }> }>(`${act}/adimages`, { method: 'POST', params: { bytes: jpeg.toString('base64') }, timeoutMs: 55_000 });
    const img = Object.values(d.images ?? {})[0];
    if (!img?.hash) throw new MetaAdsError('Meta took the cover frame but gave no reference for it.', 502);
    return NextResponse.json({ status: 'ready', progress: 100, thumb: img.url ?? pick.uri, thumbHash: img.hash });
  } catch (e) {
    return adsFail(e, 'video');
  }
}
