/**
 * Every tool an AI key can reach, in one list (registry.ts says how they are run). The order is the order the
 * AI reads them in: the guide first, then posting, reading, changing, the Studio's boards. Server-only.
 */

import { z } from 'zod';
import { STORE_CONFIG } from '@/lib/store-config';
import { houseBrief } from './house-rules';
import { tool, toolsFor, type AgentTool } from './registry';
import { SCOPES } from './scopes';
import { POST_TOOLS } from './tools-posts';
import { READ_TOOLS } from './tools-read';
import { WRITE_TOOLS } from './tools-write';
import { STUDIO_TOOLS } from './tools-studio';

/** How to work here, as the guide and the MCP server's instructions say it. */
export const HOW_TO_WORK = [
  'Call get_guide first and follow the house brief: the voice, the hard rules, what never goes in front of a customer.',
  'Posts: find_photos → view_photo → make_post (the server draws the story and the square in the house’s layouts and answers the pictures) → look, fix the words or layout with make_post again → queue_post. Queued posts wait for the owner’s one-tap OK in the ERP (Posts) unless this key may send them.',
  'Use figures only as the ERP gives them: never invent a karat, weight, carat or price. Words that break a house rule are refused with the reason — fix them and try again.',
  'Changes to the books are the app’s own writes, recorded under this key’s name in the activity log. Deleting anything needs the shop’s delete code: ask the owner for it each time, never guess it.',
  'Money changes take a request_id; send the same one if you retry, so a payment is never recorded twice.',
].map(l => `- ${l}`).join('\n');

export const GUIDE_TOOL = tool({
  name: 'get_guide', title: 'Read the guide', effect: 'read', scopes: [],
  description: 'Read FIRST. The house brief (who the house is, its voice, the hard rules for anything a customer reads, the Maisons, the hours), how to work here, and what this key may do.',
  input: z.object({}),
  run: async (_a, ctx) => {
    const mine = toolsFor(ALL_TOOLS, ctx.key.scopes);
    const scopes = SCOPES.filter(s => ctx.key.scopes.includes(s.id)).map(s => `- ${s.label} (${s.id}): ${s.detail}`).join('\n');
    return {
      text: [
        houseBrief(),
        `## How to work here\n${HOW_TO_WORK}`,
        `## This key: “${ctx.key.label}”${ctx.key.expiresAt ? `, until ${ctx.key.expiresAt.slice(0, 10)}` : ''}\n${scopes}`,
        `## Its tools\n${mine.map(t => `- ${t.name}: ${t.title}`).join('\n')}`,
        `The ERP: ${ctx.origin} (${STORE_CONFIG.name}).`,
      ].join('\n\n'),
    };
  },
});

export const ALL_TOOLS: AgentTool[] = [GUIDE_TOOL, ...POST_TOOLS, ...READ_TOOLS, ...WRITE_TOOLS, ...STUDIO_TOOLS];
