/**
 * AI words for a piece from the house's own website (Posts → From the website),
 * in that house's voice. The model writes only two things — one line that sells
 * the piece, and its facts — and the POS builds the house's frame around them
 * (sitePieceCaption: name, weight, link, closing lines), so a link or a number
 * can never be dropped or changed by the model.
 *
 * The examples are the houses' own community posts (read from the communities,
 * 2026-09-25), so the model hears how each one actually writes.
 */

export type House = 'taheri' | 'mina';

const VOICE: Record<House, string> = {
  taheri: `You write for Taheri, a family jewellery house in Karachi, established 1989, known for gold and certified diamond jewellery made at its own bench. Its customers are a close, generational community who buy on trust. Voice: a trusted family elder who is impeccably refined — premium, warm, restrained, never salesy.

How Taheri's own posts read:
- line: "Pear-cut blue topaz drops fall along an open zircon arc, carried across a matching kara and ring." — facts: "Blue topaz with zircon · kara and ring · evening statement"
- facts: "Zircon · baguette-cut huggie hoops · day-to-night wear"
- facts: "Pure Gold · openwork Arabic calligraphy · three shapes · everyday faith piece"`,
  mina: `You write for House of Mina, a jewellery house making bespoke pieces in 925 sterling silver, designed in-house. Voice: modern, confident and clean — short, vivid lines with a little wit; colour and light first; never gushing, never salesy.

How House of Mina's own posts read (line, then facts):
- "Cut to catch every light in the room." — "Ice-cut cubic zirconia in ocean blue, canary and champagne. Oval and radiant cuts. 925 sterling silver with white rhodium plating."
- "Red, blue, green. Pick your side." — "Oval simulated ruby and sapphire in marquise halos, with an emerald-cut simulated emerald on a leaf band. Brilliant cubic zirconia throughout. 925 sterling silver with white rhodium plating."
- "The one you never take off." — "Bezel-set brilliant cubic zirconia on a fine chain. 925 sterling silver with gold plating or white rhodium."
- "Soft white, cut into sharp shapes." — "Natural mother of pearl inlay with brilliant cubic zirconia. 925 sterling silver with gold plating."`,
};

const RULES: Record<House, string> = {
  taheri: `- The line: one sentence, at most 22 words, evocative — the occasion, the feeling, the wearer.
- The facts: 2–4 short parts joined by " · " (stones by colour and shape unless named below, the kind of piece, the moment to wear it). No weight, no price, no metal purity.`,
  mina: `- The line: one short sentence, at most 10 words, in the examples' manner.
- The facts: one or two sentences naming the stones exactly as given (simulated stones stay "simulated"; cubic zirconia / American diamond as given), their cuts if you can see them, then the metal and plating as given. No weight, no price.`,
};

export function siteCaptionSystem(house: House): string {
  return `${VOICE[house]}

Hard rules:
- Never invent facts. Stones, metal and plating come only from what you are given; otherwise describe what you see only by colour and shape. Never call a stone natural, real or certified unless you are told so.
- No hashtags, no emoji, no exclamation marks, no prices, no addresses, no phone numbers, no links — the post adds those itself.
${RULES[house]}`;
}

export function siteCaptionUser(p: { name: string; collection: string; facts: string[]; about: string; weight?: string }): string {
  return `Write for this piece from the website. Look at the photograph.

- Name: ${p.name}
- Collection: ${p.collection || '(not given)'}
- What the website knows: ${p.facts.join(', ') || '(nothing)'}
- The website's own words: ${p.about || '(none)'}
${p.weight ? `- Weight: ${p.weight} (the post shows it; don't repeat it)\n` : ''}
Answer with the line and the facts.`;
}

export const SITE_CAPTION_SCHEMA = {
  type: 'OBJECT',
  properties: { line: { type: 'STRING' }, facts: { type: 'STRING' } },
  required: ['line', 'facts'],
};

/** The model's words, cleaned of anything the frame adds itself (links, numbers, emoji, stray asterisks). */
export function tidyAiWords(s: string): string {
  return String(s || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\+?\d[\d\s-]{7,}\d/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
