/**
 * The REST twin described for ChatGPT's custom GPT Actions (and anything else that imports OpenAPI 3.1):
 * one POST /api/agent/v1/<tool> per tool, drawn from the registry, with the house's own ERP address as the
 * server and a bearer key. Public: it says what the tools are (the code is public anyway), never a key or
 * anything of the books. `scopes` narrows it to one key's tools (a GPT takes at most 30 actions). Pure.
 */

import { schemaOf, toolsFor, type AgentTool } from './registry';
import type { Scope } from './scopes';

/** GPT Actions cut an operation's description at 300 characters. */
const short = (s: string, n = 300) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

export function buildOpenApi(all: readonly AgentTool[], o: { serverUrl: string; house: string; scopes?: readonly Scope[] }) {
  const tools = o.scopes ? toolsFor(all, o.scopes) : toolsFor(all, ['posts:draft', 'posts:publish', 'read', 'write:shop', 'write:money', 'studio']);
  const paths: Record<string, unknown> = {};
  for (const t of tools) {
    paths[`/api/agent/v1/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: short(t.description),
        ...(t.scopes.length ? { 'x-scopes': t.scopes } : {}),
        requestBody: { required: true, content: { 'application/json': { schema: schemaOf(t) } } },
        responses: {
          200: { description: 'Done.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Answer' } } } },
          default: { description: 'Refused, with why (a missing scope, a bad id, a house rule).', content: { 'application/json': { schema: { $ref: '#/components/schemas/Refusal' } } } },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `${o.house} ERP`,
      version: '1.0.0',
      description: `${o.house}'s ERP for an AI: make posts for the owner's approval, read the books, and (when the key allows) change them. Call get_guide first.`,
    },
    servers: [{ url: o.serverUrl.replace(/\/+$/, '') }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'An AI key from Settings → Connect an AI (tk_…).' } },
      schemas: {
        Answer: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            data: { description: 'The answer.' },
            text: { type: 'string' },
            images: { type: 'array', description: 'Pictures, each at an address that works for an hour.', items: { type: 'object', properties: { url: { type: 'string' }, mimeType: { type: 'string' } } } },
          },
        },
        Refusal: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'string' } } },
      },
    },
  };
}
