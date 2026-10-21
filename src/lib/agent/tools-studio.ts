/**
 * The Ad studio's board tools (ads/studio/board-agent.ts) on the one AI endpoint, for a key with the
 * `studio` scope: the same fifteen tools /api/studio/mcp has always served, named `studio_<tool>` here so
 * they sit beside the posting tools (find_photos and view_photo are the same library either way). They
 * check their own input, as they do on the Studio's endpoint. Server-only.
 */

import { z } from 'zod';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { TOOLS as BOARD_TOOLS, callTool as callBoardTool } from '@/lib/ads/studio/board-agent';
import { tool, ToolError, type AgentTool, type Effect, type ToolImage } from './registry';

const READS = new Set(['get_style', 'list_boards', 'get_board', 'find_photos', 'view_photo', 'view_design']);

export const STUDIO_TOOLS: AgentTool[] = BOARD_TOOLS.map(t => tool({
  name: `studio_${t.name}`,
  title: `Studio: ${t.name.replace(/_/g, ' ')}`,
  description: `Ad studio board — ${t.description}`,
  scopes: ['studio'],
  effect: (READS.has(t.name) ? 'read' : 'post') as Effect,
  when: () => STORE_AD_STUDIO,
  input: z.record(z.unknown()),
  jsonSchema: t.inputSchema as unknown as Record<string, unknown>,
  run: async (args, ctx) => {
    const r = await callBoardTool(t.name, args, ctx.key.label);
    const text = r.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('\n');
    if (r.isError) throw new ToolError(text || 'That didn’t work.', 400);
    const images: ToolImage[] = r.content.filter(c => c.type === 'image').map(c => ({ data: Buffer.from((c as { data: string }).data, 'base64'), mimeType: (c as { mimeType: string }).mimeType }));
    return { text, images };
  },
}));
