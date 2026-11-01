/**
 * A JSON answer, gzipped by hand when the caller accepts it. App Hosting sends API routes
 * uncompressed (the log's response size equalled the JSON's), which a phone on mobile data feels
 * on the long lists (the website's pieces, the staff collections). Small bodies go as they are.
 */

import { NextResponse } from 'next/server';
import { gzipSync } from 'node:zlib';

/** Under this many characters gzip costs more than it saves. */
export const GZIP_MIN_CHARS = 1024;

/** Does the request's Accept-Encoding take gzip? */
export function acceptsGzip(req: { headers: Headers }): boolean {
  return /\bgzip\b/i.test(req.headers.get('accept-encoding') ?? '');
}

/** The same, for JSON text already written (a custom replacer, say). */
export function gzipJsonText(req: { headers: Headers }, text: string, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  // The answer differs by encoding, so a cache must key on it.
  const vary = headers.get('Vary');
  if (!vary) headers.set('Vary', 'Accept-Encoding');
  else if (!/accept-encoding/i.test(vary)) headers.set('Vary', `${vary}, Accept-Encoding`);

  if (acceptsGzip(req) && text.length > GZIP_MIN_CHARS) {
    headers.set('Content-Encoding', 'gzip');
    return new NextResponse(new Uint8Array(gzipSync(text)), { ...init, headers });
  }
  return new NextResponse(text, { ...init, headers });
}

/** `body` as JSON, gzipped when the request accepts it. `init` is a NextResponse's (status, headers). */
export function gzipJson(req: { headers: Headers }, body: unknown, init: ResponseInit = {}): NextResponse {
  return gzipJsonText(req, JSON.stringify(body), init);
}
