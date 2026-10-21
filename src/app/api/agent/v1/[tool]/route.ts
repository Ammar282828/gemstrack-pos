/**
 * The REST twin of /api/agent/mcp: POST /api/agent/v1/<tool> with the tool's input as the JSON body, for a
 * ChatGPT custom GPT's Actions (import /api/agent/openapi.json) or a script. The same registry, scopes, rate
 * limit and activity log as MCP (lib/agent/call.ts). Pictures come back as addresses that work for an hour.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticate, callAgentTool, contextFor, withinLimit } from '@/lib/agent/call';
import { holdPreview } from '@/lib/agent/previews';
import { ALL_TOOLS } from '@/lib/agent/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const noStore = { 'Cache-Control': 'no-store' };

export async function POST(req: NextRequest, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const check = await authenticate(req);
  if (!check.ok) return NextResponse.json({ ok: false, error: check.message }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer', ...noStore } });
  const limit = await withinLimit(check.key);
  if (!limit.ok) return NextResponse.json({ ok: false, error: 'Too many calls this hour (600). Try again shortly.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
  const text = await req.text();
  let args: unknown = {};
  if (text.trim()) {
    try { args = JSON.parse(text); } catch { return NextResponse.json({ ok: false, error: 'The body must be JSON.' }, { status: 400 }); }
  }
  const ctx = contextFor(req, check.key, { imageUrls: true });
  const r = await callAgentTool(ALL_TOOLS, tool, args, ctx);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status, headers: noStore });
  const images = await Promise.all((r.out.images ?? []).map(async i => ({ url: await holdPreview(ctx.origin, i.data, i.mimeType), mimeType: i.mimeType })));
  return NextResponse.json({ ok: true, ...(r.out.data !== undefined ? { data: r.out.data } : {}), ...(r.out.text ? { text: r.out.text } : {}), ...(images.length ? { images } : {}) }, { headers: noStore });
}
