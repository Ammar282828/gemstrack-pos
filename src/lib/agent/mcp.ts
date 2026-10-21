/**
 * The Model Context Protocol over Streamable HTTP, JSON answers only (no event stream), as the Studio's
 * /api/studio/mcp speaks it: initialize, ping, tools/list, tools/call; notifications get no answer (202).
 * Claude (claude.ai connectors, Claude Code, the desktop app), ChatGPT's connectors, Gemini CLI and Cursor
 * all speak it. The tools are the registry's (registry.ts), filtered by the key's scopes. Pure apart from
 * the `call` it is handed.
 */

import { schemaOf, type AgentTool, type RunResult, type ToolOut } from './registry';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface Rpc { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
export const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export interface McpServer {
  info: { name: string; version: string };
  instructions: string;
  /** The tools this key may see. */
  tools: AgentTool[];
  call: (name: string, args: Record<string, unknown>) => Promise<RunResult>;
}

export const listEntry = (t: AgentTool) => ({ name: t.name, title: t.title, description: t.description, inputSchema: schemaOf(t), annotations: { title: t.title, readOnlyHint: t.effect === 'read', destructiveHint: /^delete_/.test(t.name) } });

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** A tool's answer as MCP content: the data as JSON text (and structured), a line, the pictures inline. */
export function toContent(out: ToolOut): { content: Content[]; structuredContent?: Record<string, unknown> } {
  const content: Content[] = [];
  if (out.text) content.push({ type: 'text', text: out.text });
  if (out.data !== undefined) content.push({ type: 'text', text: JSON.stringify(out.data, null, 1) });
  for (const img of out.images ?? []) content.push({ type: 'image', data: img.data.toString('base64'), mimeType: img.mimeType });
  if (!content.length) content.push({ type: 'text', text: 'Done.' });
  const structured = out.data && typeof out.data === 'object' && !Array.isArray(out.data) ? (out.data as Record<string, unknown>) : undefined;
  return { content, ...(structured ? { structuredContent: structured } : {}) };
}

export async function handleRpc(m: Rpc, s: McpServer): Promise<object | null> {
  if (!m || typeof m !== 'object') return rpcError(null, -32600, 'Not a JSON-RPC message.');
  if (m.id === undefined || m.id === null) return null; // a notification: nothing to answer
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion ?? '');
      return reply(m.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: s.info,
        instructions: s.instructions,
      });
    }
    case 'ping': return reply(m.id, {});
    case 'tools/list': return reply(m.id, { tools: s.tools.map(listEntry) });
    case 'tools/call': {
      const name = String(m.params?.name ?? '');
      const args = (m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {}) as Record<string, unknown>;
      const r = await s.call(name, args);
      // A refusal is a tool error, so the AI reads why and can fix its call.
      return reply(m.id, r.ok ? toContent(r.out) : { content: [{ type: 'text', text: r.error }], isError: true });
    }
    case 'resources/list': return reply(m.id, { resources: [] });
    case 'prompts/list': return reply(m.id, { prompts: [] });
    default: return rpcError(m.id, -32601, `No method ${m.method}.`);
  }
}
