/**
 * The public routes under /api/public are called from a different origin —
 * the static site at taheri.shop — so they answer preflights and name that
 * origin, and no other. The POS's own pages never need these headers.
 */

import { NextRequest, NextResponse } from 'next/server';

function allowedOrigins(): string[] {
  const site = (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
  const list = [site, site.replace('://', '://www.')];
  if (process.env.NODE_ENV !== 'production') list.push('http://localhost:5180', 'http://127.0.0.1:5180');
  return list;
}

export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = allowedOrigins().includes(origin) ? origin : allowedOrigins()[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}

export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export function json(req: NextRequest, body: unknown, init: ResponseInit = {}): NextResponse {
  const res = NextResponse.json(body, init);
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
