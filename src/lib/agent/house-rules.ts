/**
 * The house's rules for anything an outside AI writes for customers, drawn from where the ERP already keeps
 * them — the brand book (ads/studio/brand.ts: voice, hard rules, marks, visual, House of Mina's ad style),
 * the caption writer's hard rules (social/prompts.ts captionSystem: no market or area name, no urgency),
 * the Maisons (website/maisons.ts) and the shop's hours (store-config) — never restated here by hand.
 * `copyProblems` holds an AI's words to the same tests the board agent's are held to. Pure.
 */

import { brandBrief } from '@/lib/ads/studio/brand';
import { breaksHouseRule, inventedFigures } from '@/lib/ads/studio/prompts';
import { captionSystem } from '@/lib/social/prompts';
import { MAISON_HOUSES } from '@/lib/website/maisons';
import { STORE_BRAND, STORE_CONFIG, STORE_LINKS_PAGE } from '@/lib/store-config';

const house = (): 'taheri' | 'mina' => (STORE_BRAND === 'mina' ? 'mina' : 'taheri');

/**
 * The caption writer's own line — 'Never mention a street, market or area name (no "Najmi Market", no "Saddar"), …
 * no "limited", "only a few left", "hurry" or any urgency.' — read for its words: the places are the quoted
 * names inside the brackets, the urgency the quoted words after them.
 */
const CAPTION_RULE = captionSystem(STORE_CONFIG.name, house()).split('\n').find(l => /street, market or area/i.test(l)) ?? '';
const quoted = (t: string) => [...t.matchAll(/"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean);
const bracket = /\(([^)]*)\)/.exec(CAPTION_RULE);
const PLACE_WORDS = bracket && quoted(bracket[1]).length ? quoted(bracket[1]) : ['Najmi Market', 'Saddar'];
const URGENCY_WORDS = bracket ? quoted(CAPTION_RULE.slice(bracket.index + bracket[0].length)) : [];
const wordsRe = (ws: string[]) => (ws.length ? new RegExp(`\\b(${ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null);
const placeRe = wordsRe(PLACE_WORDS);
const urgencyRe = wordsRe(URGENCY_WORDS);

const isMaison = (name: string, collection = '') =>
  /(^|\/)The Maisons$/i.test(collection) || MAISON_HOUSES.some(h => name.toLowerCase().startsWith(h.toLowerCase()));

/**
 * What is wrong with words an AI wants a customer to read, against the house's rules; empty when they pass.
 * `facts` is what the ERP knows of the piece (its specs line, weight): no figure may appear that isn't in it.
 */
export function copyProblems(text: string, facts: string, piece?: { name: string; collection?: string }): string[] {
  const out: string[] = [];
  const t = String(text || '');
  if (!t.trim()) return out;
  if (breaksHouseRule(t)) out.push('it has sale or discount words, or a hashtag');
  if (placeRe?.test(t)) out.push(`it names a market or area (${PLACE_WORDS.join(', ')}), which never goes in front of a customer`);
  if (urgencyRe?.test(t)) out.push(`it pushes with urgency (${URGENCY_WORDS.join(', ')}), which the house never does`);
  const made = inventedFigures(t, facts);
  if (made.length) out.push(`it has ${made.join(', ')}, which the ERP didn't give (the facts are “${facts || 'none'}”)`);
  if (piece && isMaison(piece.name, piece.collection) && /(per\s+(gram|tola)|\/\s?g\b|today[’']?s\s+(gold\s+)?(rate|price))/i.test(t)) {
    out.push('it prices a Maisons piece by the gram or the gold rate; the great houses’ pieces are never priced that way');
  }
  return out;
}

/** The brief an AI reads before writing anything (get_guide, the MCP server's instructions). */
export function houseBrief(): string {
  const caption = captionSystem(STORE_CONFIG.name, house());
  return [
    `# ${STORE_CONFIG.name} — the house brief`,
    brandBrief(),
    `## Captions and anything a customer reads\n${caption}`,
    `## Hours (as the shop states them; never a street or market)\n${STORE_LINKS_PAGE.visit.map(l => `- ${l}`).join('\n')}`,
    `## The Maisons\nThe great houses' own pieces (${MAISON_HOUSES.join(', ')}) are named by the house and the official model name, and never priced by the gram or the gold rate. Don't write a karat, weight or price for one unless the ERP gives it.`,
    `## Words are checked\nEvery headline, line and caption you write is checked before anything is made: no sale or discount words or hashtags, no market or area name, and no figure (karat, weight, carat, price) that the ERP's own facts for the piece don't have. A refusal says which rule; fix the words and try again.`,
  ].join('\n\n');
}
