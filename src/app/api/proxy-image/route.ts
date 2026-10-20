import { NextRequest, NextResponse } from 'next/server';

/**
 * Hands an image to the browser from the same origin (the PDF logo needs bytes it can draw).
 * Locked down on purpose (security audit 2026-10): a proxy that echoes any host's Content-Type is a way to serve
 * HTML from the ERP's own origin. So: a relative path must resolve to this origin (`/\evil.com` does not),
 * an absolute URL must match an exact host and path prefix, only image/* answers pass, no redirects, 10 MB.
 */
const MAX_BYTES = 10 * 1024 * 1024;

function allowed(url: string, origin: string): URL | null {
  let u: URL;
  try { u = new URL(url, origin); } catch { return null; }
  const relative = url.startsWith('/') && !url.startsWith('//');
  if (relative) return u.origin === origin ? u : null;
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const bucket = (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim();
  if (u.host === 'firebasestorage.googleapis.com') {
    return bucket && u.pathname.startsWith(`/v0/b/${bucket}/o/`) ? u : null; // this house's bucket only
  }
  if (bucket && u.host === bucket) return u;
  if (u.host === 'houseofmina.store' && u.pathname.startsWith('/cdn/')) return u;
  return null;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }
  const target = allowed(url, request.nextUrl.origin);
  if (!target) return NextResponse.json({ error: 'URL not allowed' }, { status: 403 });

  let response: Response;
  try {
    response = await fetch(target.toString(), { redirect: 'error' });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 502 });
  }
  if (!response.ok) {
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: response.status });
  }
  const contentType = response.headers.get('Content-Type') || '';
  if (!/^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon)\b/i.test(contentType)) {
    // SVG is left out: it can carry script.
    return NextResponse.json({ error: 'Not an image' }, { status: 415 });
  }
  const declared = Number(response.headers.get('Content-Length') || 0);
  if (declared > MAX_BYTES) return NextResponse.json({ error: 'Image too large' }, { status: 413 });
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) return NextResponse.json({ error: 'Image too large' }, { status: 413 });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
