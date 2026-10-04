/**
 * The Studio's boards for an agent — a Model Context Protocol server over Streamable HTTP
 * (JSON answers, no event stream), tools in lib/ads/studio/board-agent.ts.
 *
 *   claude mcp add --transport http taheri-studio https://erp.taheri.shop/api/studio/mcp \
 *     --header "Authorization: Bearer tstudio_…"
 *
 * The key is made in Ads → Studio → Board → Connect an agent (kept as a hash; revocable there).
 * 600 calls an hour per key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { checkAgentKey } from '@/lib/ads/studio/board';
import { INSTRUCTIONS, PROTOCOL_VERSIONS, SERVER_INFO, TOOLS, callTool } from '@/lib/ads/studio/board-agent';
import { rateLimit } from '@/lib/website/ratelimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface Rpc { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const error = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(m: Rpc, who: string): Promise<object | null> {
  if (m.id === undefined || m.id === null) return null; // a notification: nothing to answer
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion ?? '');
      return reply(m.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping': return reply(m.id, {});
    case 'tools/list': return reply(m.id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(m.params?.name ?? '');
      const args = (m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {}) as Record<string, unknown>;
      try {
        return reply(m.id, await callTool(name, args, who));
      } catch (e) {
        // A tool that fails answers as a tool error, so the agent reads why and can fix its call.
        return reply(m.id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    default: return error(m.id, -32601, `No method ${m.method}.`);
  }
}

export async function POST(req: NextRequest) {
  if (!STORE_AD_STUDIO) return NextResponse.json({ error: 'Not part of this shop.' }, { status: 404 });
  const key = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const who = await checkAgentKey(key).catch(() => null);
  if (!who) return NextResponse.json(error(null, -32001, 'A Studio key is needed: Ads → Studio → Board → Connect an agent.'), { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } });
  const limit = await rateLimit('studio-mcp', key.slice(-12), 600, 3_600);
  if (!limit.ok) return NextResponse.json(error(null, -32002, 'Too many calls this hour (600). Try again shortly.'), { status: 429 });
  const body = await req.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json(error(null, -32700, 'Not JSON.'), { status: 400 });
  const batch = Array.isArray(body);
  const answers = (await Promise.all((batch ? body : [body]).map((m: Rpc) => handle(m, who)))).filter(Boolean);
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
