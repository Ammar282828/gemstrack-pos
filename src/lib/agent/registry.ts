/**
 * The one list of what an outside AI can do in the ERP (docs/features/ai-keys.md). MCP (/api/agent/mcp),
 * the REST twin (/api/agent/v1/<tool>) and the OpenAPI document (/api/agent/openapi.json) are all drawn
 * from it, so there is one copy of each tool: its name, words, input (zod, checked on every call), the
 * scope it needs, and what it runs.
 *
 * Every call goes through `runTool`: the house has it, the key has the scope (checked here, server-side,
 * on every call — a tool the key may not use is refused with which scope it needs), the input passes its
 * schema, then it runs. Logging and the rate limit are the routes' (call.ts). Pure apart from the tools.
 */

import { z } from 'zod';
import type { AgentKey } from './keys';
import { scopeLabel, type Scope } from './scopes';
import { toJsonSchema, type JsonSchema } from './json-schema';

export interface AgentCtx {
  key: AgentKey;
  /** This ERP's public address, for links in answers. */
  origin: string;
  /** Where Instagram fetches a story from (the backend's own address; social/gate.ts mediaOrigin). */
  mediaOrigin: string;
  /** "via ChatGPT": how the activity log names the key. */
  via: string;
  /** The activity log, as the shared writes call it (call.ts writes it in both of the log's shapes). */
  log: (action: string, title: string, detail: string, ref?: string) => Promise<void>;
  /** The REST twin answers pictures as short-lived addresses; MCP sends them inline. */
  imageUrls: boolean;
}

export interface ToolImage { data: Buffer; mimeType: string }
export interface ToolOut {
  /** The answer, as JSON (MCP sends it as text; REST as the body). */
  data?: unknown;
  /** A plain line instead of, or beside, the data. */
  text?: string;
  images?: ToolImage[];
  /** The tool already wrote its own activity-log line (the shared writes do), so the route doesn't add one. */
  logged?: boolean;
}

/** A refusal the AI should read and act on (a missing scope, a bad id, a rule broken). */
export class ToolError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type Effect = 'read' | 'post' | 'write';

export interface AgentTool<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  /** Short, for lists ("Make a post"). */
  title: string;
  /** What it does and when to use it, for the AI (MCP and OpenAPI). The first sentence is the summary. */
  description: string;
  /** Any one of these lets a key use it; empty means any key. */
  scopes: Scope[];
  input: I;
  /** A schema to publish instead of the one drawn from `input` (tools whose input is checked inside). */
  jsonSchema?: JsonSchema;
  effect: Effect;
  /** This house has it (store-config flags). Absent: always. */
  when?: () => boolean;
  /** More scopes the arguments call for (a repair with an advance also takes money). */
  needs?: (args: z.infer<I>) => Scope[];
  run: (args: z.infer<I>, ctx: AgentCtx) => Promise<ToolOut>;
}

export const tool = <I extends z.ZodTypeAny>(t: AgentTool<I>): AgentTool => t as unknown as AgentTool;

const here = (t: AgentTool) => !t.when || t.when();
export const mayUse = (t: AgentTool, scopes: readonly Scope[]) => !t.scopes.length || t.scopes.some(s => scopes.includes(s));

/** The tools a key may see: this house's, within its scopes. */
export const toolsFor = (all: readonly AgentTool[], scopes: readonly Scope[]): AgentTool[] => all.filter(t => here(t) && mayUse(t, scopes));

export const schemaOf = (t: AgentTool): JsonSchema => t.jsonSchema ?? toJsonSchema(t.input);

/** "a, b or c" */
const either = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

export function refusalFor(t: AgentTool, scopes: readonly Scope[]): string | null {
  if (mayUse(t, scopes)) return null;
  return `This key may not use ${t.name}: it needs “${either(t.scopes.map(scopeLabel))}” (${either(t.scopes)}). The owner can make a key with it in Settings → Connect an AI.`;
}

export type RunResult = { ok: true; tool: AgentTool; out: ToolOut } | { ok: false; status: number; error: string; tool?: AgentTool };

/** Find, check and run one tool. Never throws: a failure is an answer the AI can read. */
export async function runTool(all: readonly AgentTool[], name: string, raw: unknown, ctx: AgentCtx): Promise<RunResult> {
  const t = all.find(x => x.name === name && here(x));
  if (!t) return { ok: false, status: 404, error: `No tool “${String(name).slice(0, 60)}”. get_guide lists what this key can do.` };
  const no = refusalFor(t, ctx.key.scopes);
  if (no) return { ok: false, status: 403, error: no, tool: t };
  const parsed = t.input.safeParse(raw ?? {});
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, status: 400, error: `${i?.path.length ? `${i.path.join('.')}: ` : ''}${i?.message ?? 'That input is not right.'}`, tool: t };
  }
  const extra = t.needs?.(parsed.data).filter(s => !ctx.key.scopes.includes(s)) ?? [];
  if (extra.length) return { ok: false, status: 403, error: `This needs “${either(extra.map(scopeLabel))}” (${either(extra)}) as well, which this key doesn't have.`, tool: t };
  try {
    return { ok: true, tool: t, out: await t.run(parsed.data, ctx) };
  } catch (e) {
    const status = e instanceof ToolError ? e.status : typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 500;
    const message = e instanceof Error ? e.message : String(e);
    if (status >= 500) console.error(`[agent] ${name}:`, message);
    return { ok: false, status, error: status >= 500 && !(e instanceof ToolError) ? `It didn’t work: ${message.slice(0, 300)}` : message, tool: t };
  }
}
