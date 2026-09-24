/**
 * What Post a Piece asks the image and text models for.
 *
 * Pure strings, kept apart from the calls so they can be read, tested and
 * tuned without touching the plumbing. The image prompts follow the rules the
 * shop's Nano Banana work settled on (nanobanana-jewelry skill):
 *
 *   · the piece must not change, and that is said first;
 *   · the metal is never named — "match the metal in the reference" — because
 *     naming it pulls the model towards a generic version of that metal;
 *   · anything mentioned gets drawn, so what must not appear goes only in the
 *     closing Avoid line, and the rest is phrased as what to do;
 *   · a creative brief in sentences, not a list of tags.
 *
 * The scenes are the ones the shop's own stories use (Sept 2026 screenshots):
 * the bottle-green leather box on cream silk, the cream velvet bust, the white
 * satin glove, a hand against deep green, black velvet, the open green suede
 * box held in a hand.
 */

export const ASPECTS = ['9:16', '4:5', '1:1', '5:4', '3:4', '4:3', '2:3', '3:2', '16:9'] as const;
export type Aspect = typeof ASPECTS[number];

/** The supported ratio nearest a photo's own, so an edit keeps its shape. */
export function nearestAspect(width: number, height: number): Aspect {
  const r = width / height;
  let best: Aspect = '1:1', bestDiff = Infinity;
  for (const a of ASPECTS) {
    const [w, h] = a.split(':').map(Number);
    const diff = Math.abs(Math.log(r / (w / h)));
    if (diff < bestDiff) { bestDiff = diff; best = a; }
  }
  return best;
}

export interface Scene { id: string; label: string; brief: string; suits: string }

export const SCENES: Scene[] = [
  { id: 'green-box', label: 'Green box, cream silk', suits: 'bangles, rings, bracelets, small pieces',
    brief: 'resting against a closed deep bottle-green leather jewellery box with a fine stitched edge, on softly draped cream silk, warm diffused window light from the left, gentle shadows' },
  { id: 'velvet-bust', label: 'Cream velvet bust', suits: 'necklaces, sets, chokers, earrings',
    brief: 'displayed on a cream velvet neck bust against a warm ivory wall, soft warm glow, the necklace draped naturally and earrings at ear height' },
  { id: 'white-glove', label: 'White satin glove', suits: 'bangles, rings, bracelets, pendants',
    brief: 'held up delicately by a hand in a white satin glove against a smooth warm beige studio backdrop, soft even light' },
  { id: 'hand-green', label: 'Hand on deep green', suits: 'bangles, rings, anything with coloured stones',
    brief: 'held between thumb and fingers against a deep forest-green seamless backdrop, soft studio light, shallow depth of field' },
  { id: 'black-velvet', label: 'Black velvet', suits: 'rings, bands, diamonds, emeralds',
    brief: 'nestled in a black velvet ring roll, low-key warm light with rich shadows and bright highlights on the stones' },
  { id: 'suede-box', label: 'Open green box in hand', suits: 'bangles, bracelets, rings, earrings',
    brief: 'set inside an open emerald-green suede jewellery box held in a hand, against a bright clean white background' },
  { id: 'champagne-silk', label: 'Champagne silk', suits: 'anything',
    brief: 'laid on brushed champagne silk with soft folds, warm heritage lighting, gentle warm reflections' },
];

const FIDELITY = 'Use the attached photograph(s) as the exact product. Preserve every detail of the jewellery faithfully — every stone, its colour and cut, every setting, prong, link, engraving and texture, and the proportions — exactly as in the reference. Do not redesign or reinterpret. Match the metal colour in the reference precisely.';
const AVOID = 'Avoid: redesigning the piece, adding or removing stones, extra jewellery, text, letters, numbers, logos, watermarks, price tags.';

const storyRoom = (aspect: Aspect) => aspect === '9:16'
  ? ' This is an Instagram story: keep the jewellery in the lower sixty percent of the frame and leave the top third calm, softly lit and uncluttered, with room for a headline.'
  : '';

export interface EnhanceOptions {
  /** Take out price tags, strings, stickers and old labels burned into the photo. */
  tidy: boolean;
}

export function enhancePrompt(o: EnhanceOptions): string {
  return [
    FIDELITY,
    'Keep the same camera angle, framing, display and backdrop. Improve only the photography, as a high-end retoucher would: clean away dust, lint and fingerprints; correct the white balance to clean, warm-neutral light; bring back the true sparkle and clarity of the stones; sharpen fine detail; lift shadows gently; make the backdrop even and tidy.',
    o.tidy ? 'Remove any price tag, string, sticker or label, and any text, weight or logo printed onto the photograph, filling behind them naturally.' : '',
    'Photorealistic and colour-accurate.',
    AVOID,
  ].filter(Boolean).join(' ');
}

export function reframePrompt(aspect: Aspect, tidy: boolean): string {
  return [
    FIDELITY,
    `Extend this photograph to a ${aspect} frame. Keep the original photograph exactly as it is and continue the same surface, display, backdrop and lighting naturally into the new space, as if the camera had captured a wider view.`,
    storyRoom(aspect),
    tidy ? 'Remove any price tag, string, sticker or label, and any text, weight or logo printed onto the photograph.' : '',
    AVOID,
  ].filter(Boolean).join(' ');
}

export function restagePrompt(scene: string, aspect: Aspect): string {
  return [
    FIDELITY,
    `Place the piece as the hero of a high-end jewellery photograph: ${scene}.`,
    'The jewellery is tack-sharp with clean white fire in the stones and metal that reads bright and luxurious; the setting supports it and never covers any part of it.',
    storyRoom(aspect),
    `Photorealistic, ${aspect} frame, editorial and refined, heritage rather than cold or minimal.`,
    AVOID,
  ].filter(Boolean).join(' ');
}

export interface LetteringText {
  kicker: string;
  headline: string;
  weight: string;
  details: string;
  headlineColour: string;
  bodyColour: string;
  align: 'left' | 'center';
}

/** For the AI-lettered story: the typography only, on an image that already has the scene. */
export function letteringPrompt(t: LetteringText): string {
  const lines = [
    t.kicker && `a small line "${t.kicker}" in a light geometric sans-serif, colour ${t.bodyColour}, just above the headline`,
    `the headline "${t.headline}" in a very heavy, tightly condensed sans-serif, colour ${t.headlineColour}, large — about four-fifths of the frame's width at most`,
    t.weight && `beneath it "${t.weight}" in a light geometric sans-serif, colour ${t.bodyColour}, about a third of the headline's height`,
    t.details && `then a small line "${t.details}" in the same light sans-serif, colour ${t.bodyColour}`,
  ].filter(Boolean);
  return [
    'Add typography to this Instagram story image, the way a luxury jeweller’s story is lettered. Keep the photograph and the jewellery exactly as they are — change nothing but adding the text.',
    `In the calm top third, ${t.align === 'center' ? 'centred' : 'left-aligned with a generous margin'}, set: ${lines.join('; ')}.`,
    'Spell every word and number exactly as given, character for character. Crisp, flat, perfectly legible lettering with no effects, no outlines and no shadows.',
    'Avoid: any other text, logos, watermarks, changes to the jewellery.',
  ].join(' ');
}

// ── Text: the caption and the plan for a story ─────────────────────────────

export interface CaptionFacts {
  shop: string;
  /** Exactly as the counter typed them; the model may not change these. */
  headline: string;
  weight: string;
  metal: string;
  stones: string;
  collection: string;
  numbers: string[];
  link: string;
  /** Scene ids the plan may choose from. */
  scenes: { id: string; label: string; suits: string }[];
  palettes: { id: string; label: string }[];
}

export function captionSystem(shop: string): string {
  return `You write for ${shop}, a family jewellery house in Karachi, established 1989, known for gold and certified diamond jewellery made at its own bench. Its customers are a close, generational community who buy on trust.

Voice: a trusted family elder who is impeccably refined. Premium, warm, restrained, never salesy. Evocative rather than descriptive: the occasion, the feeling, the wearer — in few words.

Hard rules:
- Never invent facts. Weight, karat/metal and stone names come only from what you are given; if stones are not given, you may describe what you see only by colour and shape (for example "red stones", "green pear-cut stones") and never call them natural, real, certified or name a gemstone.
- Never mention a street, market or area name (no "Najmi Market", no "Saddar"), no prices, no discounts, no "limited", "only a few left", "hurry" or any urgency.
- WhatsApp formatting only: *bold*, _italic_. No markdown headings, no hashes in the WhatsApp caption.
- British spelling. At most two emoji in a caption, and only the ones in the template.`;
}

export function captionUserPrompt(f: CaptionFacts): string {
  return `A new piece is being posted. Look at the photograph(s) and write for it.

Facts from the counter (use exactly as written; blank means not given):
- Headline typed: ${f.headline || '(blank — suggest one)'}
- Weight: ${f.weight || '(blank)'}
- Metal: ${f.metal || '(blank)'}
- Stones: ${f.stones || '(blank)'}
- Website collection: ${f.collection || '(none)'}
- WhatsApp numbers: ${f.numbers.join(', ') || '(none)'}
- Link: ${f.link || '(none)'}

Return:
- headlines: three short story headlines in the shop's style — one to four words, Title Case, plain and confident, like "Bangle & Ring", "Everyday Bangles", "Set of the Day", "Rubies", "Emerald". If a headline was typed, the first is that one unchanged.
- kicker: an optional tiny line that sits above the headline (like "Lightweight" or "For the love of"), or "" for none.
- stonesSeen: what the stones look like by colour and cut only (for the counter to confirm), or "" if there are none.
- hook: one evocative sentence of at most fourteen words.
- whatsappCaption: the WhatsApp post, in exactly this shape —
  line 1: ✨ *<headline>* — _<metal> | <weight>_   (leave out whichever of metal/weight is blank; keep the weight exactly as given, e.g. 18.8g)
  blank line, then the hook
  blank line, then an italic line of stones · occasion · feeling, e.g. _Rubies & pearls · festive evenings · heirloom_
  blank line, then *Ask for today's price:* on its own line, then "💬 WhatsApp: " followed by the numbers exactly as given, then (if a link was given) "🌐 See it at *<link>*".
- instagramCaption: a short feed caption: the piece and its facts in one line, one line of feeling, "Ask for today's price on WhatsApp — <first number>", the link if given, then four to six hashtags from #taheri #taheridiamonds #karachijewellery #goldjewellerykarachi #pakistanijewellery and one for the piece type.
- sceneId: the best backdrop for this piece's story from: ${f.scenes.map(s => `${s.id} (${s.label}; suits ${s.suits})`).join('; ')}.
- paletteId: the lettering colours that will read best and suit the scene, from: ${f.palettes.map(p => `${p.id} (${p.label})`).join(', ')}.
- align: "left" or "center".
- weightOwnLine: true to show the weight large under the headline, false to put it in the small details line.`;
}

/** Vertex response schema for the caption call (uppercase OpenAPI types). */
export const CAPTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headlines: { type: 'ARRAY', items: { type: 'STRING' } },
    kicker: { type: 'STRING' },
    stonesSeen: { type: 'STRING' },
    hook: { type: 'STRING' },
    whatsappCaption: { type: 'STRING' },
    instagramCaption: { type: 'STRING' },
    sceneId: { type: 'STRING' },
    paletteId: { type: 'STRING' },
    align: { type: 'STRING', enum: ['left', 'center'] },
    weightOwnLine: { type: 'BOOLEAN' },
  },
  required: ['headlines', 'kicker', 'stonesSeen', 'hook', 'whatsappCaption', 'instagramCaption', 'sceneId', 'paletteId', 'align', 'weightOwnLine'],
};

export interface CaptionResult {
  headlines: string[];
  kicker: string;
  stonesSeen: string;
  hook: string;
  whatsappCaption: string;
  instagramCaption: string;
  sceneId: string;
  paletteId: string;
  align: 'left' | 'center';
  weightOwnLine: boolean;
}

// ── Checking an edit ───────────────────────────────────────────────────────

export const CHECK_SYSTEM = 'You are a meticulous jewellery quality controller comparing a reference photograph with an edited image of what should be the same physical piece. Backgrounds, props, lighting, framing and angle are allowed to differ. Only the jewellery itself matters.';

export const CHECK_PROMPT = 'Image 1 is the reference photograph. Image 2 is the edited image. Is the jewellery in image 2 the same piece as in image 1 — the same number, colour, cut and arrangement of stones, the same settings and metalwork, the same shape and proportions, the same metal colour? List every difference you can see in the jewellery itself, most important first, in plain words a shopkeeper would use. Ignore anything that is not the jewellery.';

export const CHECK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    samePiece: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    differences: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['samePiece', 'confidence', 'differences'],
};

export interface CheckResult { samePiece: boolean; confidence: number; differences: string[] }

export const READ_PROMPT = 'Transcribe every piece of text visible in this image, exactly as it is spelled, one line per line of text, top to bottom. Return only the text.';

/** Loose comparison for reading lettering back: case, spacing and curly quotes do not count. */
export function sameText(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').replace(/\s*\|\s*/g, '|').trim();
  return n(a) === n(b);
}
