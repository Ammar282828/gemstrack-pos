/**
 * Make it with AI's art director, for the maker's /api/ads/studio/auto (op=direct) and the board's
 * weekly run (weekly.ts): from the photo and the ERP's facts, the layout and every word — filtered
 * against the house's rules (no sale words, no hashtags, no figure the ERP didn't give).
 * Server-only.
 */

import { TEXT_MODEL, generateJson, type InlineImage } from '@/lib/social/ai';
import { SCENES } from '@/lib/social/prompts';
import { DIRECT_SCHEMA, DIRECT_SYSTEM, breaksHouseRule, directPrompt, inventedFigures, type Direction } from './prompts';

export interface DirectParams {
  name: string; collection: string; specs: string; price: string; brief: string;
  /** "portrait (4:5)" — the shape as the model reads it. */
  format: string;
  destination: string;
}

export async function artDirect(photo: InlineImage, p: DirectParams): Promise<Direction> {
  const facts = [p.specs, p.price].filter(Boolean).join(' · ');
  const d = await generateJson<Direction>({
    model: process.env.AD_STUDIO_TEXT_MODEL?.trim() || TEXT_MODEL, system: DIRECT_SYSTEM, schema: DIRECT_SCHEMA, temperature: 0.7,
    parts: [{ inlineData: photo }, { text: directPrompt({
      name: p.name, collection: p.collection, specs: p.specs, price: p.price, brief: p.brief,
      format: p.format, destination: p.destination || 'a WhatsApp chat with the shop',
      scenes: SCENES.map(x => `${x.id} (${x.label}; suits ${x.suits})`).join(', '),
    }) }],
  });
  const ok = (t: unknown, max: number) => typeof t === 'string' && t.trim().length > 0 && t.length <= max && !breaksHouseRule(t) && inventedFigures(t, facts).length === 0;
  // Lines on a picture take no full stop; a kicker that only repeats the specs line is dropped.
  const line = (t: string) => t.trim().replace(/[.。]+$/, '');
  const specs = p.specs.toLowerCase();
  const kicker = ok(d.kicker, 40) ? line(d.kicker) : '';
  return {
    layout: d.layout, why: String(d.why || '').slice(0, 300),
    kicker: kicker && specs.includes(kicker.toLowerCase()) ? '' : kicker,
    headline: ok(d.headline, 60) ? line(d.headline) : p.name.slice(0, 60),
    cta: ok(d.cta, 60) ? line(d.cta) : 'Message us for today’s price',
    primaryText: (d.primaryText ?? []).filter(t => ok(t, 600)),
    adHeadlines: (d.adHeadlines ?? []).filter(t => ok(t, 60)),
    extend: !!d.extend,
    scene: SCENES.some(x => x.id === d.scene) ? d.scene : null,
  };
}
