/**
 * The ERP for an outside AI — a Model Context Protocol server over Streamable HTTP (JSON answers, no event
 * stream), for Claude, ChatGPT's connectors, Gemini CLI, Cursor (docs/features/ai-keys.md).
 *
 *   claude mcp add --transport http taheri-erp https://erp.taheri.shop/api/agent/mcp \
 *     --header "Authorization: Bearer tk_taheri_…"
 *
 * The key is made in Settings → Connect an AI (kept as a hash, revocable there); a connector that can only
 * sign in is sent through /api/agent/oauth/* to paste it once. The tools are lib/agent's registry, filtered
 * by the key's scopes and checked again on every call; 600 calls an hour per key; every call is in the
 * activity log under the key's name. No browser CORS: the AIs call from their servers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { STORE_CONFIG } from '@/lib/store-config';
import { authenticate, callAgentTool, contextFor, withinLimit } from '@/lib/agent/call';
import { handleRpc, rpcError, type Rpc } from '@/lib/agent/mcp';
import { toolsFor } from '@/lib/agent/registry';
import { ALL_TOOLS, HOW_TO_WORK } from '@/lib/agent/tools';
import { challenge } from '@/lib/agent/oauth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_BATCH = 10;
const SERVER_INFO = { name: `${STORE_CONFIG.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-erp`, version: '1.0.0' };

export async function POST(req: NextRequest) {
  const check = await authenticate(req);
  if (!check.ok) {
    return NextResponse.json(rpcError(null, -32001, check.message), { status: 401, headers: { 'WWW-Authenticate': challenge(req), 'Cache-Control': 'no-store' } });
  }
  const limit = await withinLimit(check.key);
  if (!limit.ok) return NextResponse.json(rpcError(null, -32002, `Too many calls this hour (600). Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`), { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json(rpcError(null, -32700, 'Not JSON.'), { status: 400 });
  // A batch is one request but many calls: kept small, and each call is still counted against the hour.
  if (Array.isArray(body) && body.length > MAX_BATCH) return NextResponse.json(rpcError(null, -32600, `At most ${MAX_BATCH} messages in a batch.`), { status: 400 });
  if (Array.isArray(body)) for (let i = 1; i < body.length; i++) if (!(await withinLimit(check.key)).ok) return NextResponse.json(rpcError(null, -32002, 'Too many calls this hour (600).'), { status: 429 });
  const ctx = contextFor(req, check.key, { imageUrls: false });
  const server = {
    info: SERVER_INFO,
    instructions: `${STORE_CONFIG.name}'s ERP. Call get_guide first.\n${HOW_TO_WORK}`,
    tools: toolsFor(ALL_TOOLS, check.key.scopes),
    call: (name: string, args: Record<string, unknown>) => callAgentTool(ALL_TOOLS, name, args, ctx),
  };
  const batch = Array.isArray(body);
  const answers = (await Promise.all((batch ? body : [body]).map((m: Rpc) => handleRpc(m, server)))).filter(Boolean);
  if (!answers.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(batch ? answers : answers[0], { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  // No server-to-client stream: everything is answered on the POST.
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
