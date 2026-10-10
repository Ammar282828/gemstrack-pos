/** The app's local artwork engine. Only pixels and documents cross this bridge; all controls are SwiftUI. */
import * as E from '../../../src/lib/social/editor';
import * as D from '../../../src/lib/social/design';
import * as A from '../../../src/lib/ads/studio/templates';
import { PALETTES } from '../../../src/lib/social/palettes';
import { loadImage } from '../../../src/lib/social/story';
import { SCENES } from '../../../src/lib/social/prompts';
import { isMaisonFolder, maisonFileName, MAISON_HOUSES } from '../../../src/lib/website/maisons';
import { PLAYS, STAGES } from '../../../src/lib/ads/studio/plays';
import { PLAYBOOK } from '../../../src/lib/ads/studio/playbook';
import { BRAND } from '../../../src/lib/ads/studio/brand';
import { weightLabel, detailsLine, whatsappCaption, websiteFileName } from '../../../src/lib/social/caption';

declare const NATIVE_MARK: string;
declare const NATIVE_FONTS: string;
const fonts: E.FontFamilies = { headline: 'Headline', body: 'Body', serif: 'Didone', extra: { cormorant: 'Cormorant', playfair: 'Playfair', script: 'Script', montserrat: 'Montserrat', cinzel: 'Cinzel' } };
const ready = (async () => {
  const style = document.createElement('style'); style.textContent = NATIVE_FONTS; document.head.appendChild(style);
  await Promise.all(['800 100px Headline', '300 40px Body', '400 40px Body', '700 40px Body', '500 40px Didone', 'italic 400 40px Didone', '300 40px "Taheri Stamp"', '500 40px Cormorant', 'italic 500 40px Cormorant', '700 40px Playfair', '400 40px Script', '400 40px Montserrat', '700 40px Montserrat', '500 40px Cinzel'].map(f => document.fonts.load(f)));
  return loadImage(NATIVE_MARK);
})();
const images = new Map<string, { src: string; img: HTMLImageElement }>();
const defaults = (photoId: string | null, height = 1920): E.StoryDoc => ({ ...E.emptyDoc(photoId), frame: { w: 1080, h: height } });

async function run(input: any) {
  const mark = await ready;
  const photos: Record<string, HTMLImageElement> = {};
  for (const [id, src] of Object.entries(input.photos ?? {}) as [string, string][]) {
    const old = images.get(id);
    const img = old?.src === src ? old.img : await loadImage(src);
    images.set(id, { src, img }); photos[id] = img;
  }
  for (const key of [...images.keys()]) if (!(key in (input.photos ?? {}))) images.delete(key);
  const assets: E.Assets = { photos, marks: { wordmark: mark }, fonts, ink: input.house === 'mina' ? '#540000' : '#111111' };
  let doc: E.StoryDoc = structuredClone(input.doc ?? defaults(Object.keys(photos)[0] ?? null));
  const fields: E.Fields = { kicker: '', headline: '', weight: '', details: '', ...input.fields };
  const selected = new Set<string>(input.selected ?? []);
  const color = input.color ?? '#FFFFFF';
  const palette = PALETTES.find(p => p.id === input.palette) ?? PALETTES[0];
  if (input.format) {
    const info = A.formatInfo(input.format, input.custom);
    doc.frame = info.frame;
  }
  const frame = E.frameOf(doc);
  const action = input.action ?? 'render';
  const additions: E.Layer[] = [];
  if (action === 'preset') doc = E.applyPreset(doc, input.value, palette, fields, assets, { weightOwnLine: input.weightOwnLine !== false, wordmark: true });
  if (action === 'square') doc = E.applySquarePreset(doc, input.value === 'catalogue-t' ? 'catalogue' : input.value, fields, assets);
  if (action === 'ad') doc = A.applyAdTemplate(doc, input.value, fields, assets, { photoMarked: !!input.photoMarked, rates: input.rates?.rows ? input.rates : input.rates ? A.rateBoard(input.rates, new Date().toLocaleDateString('en-GB', {weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Karachi'})) : null });
  if (action === 'carry') additions.push(...E.carryLayers(input.layers ?? [], input.fromFrame ?? frame, doc, fields, assets));
  if (action === 'palette') doc = E.applyPalette(doc, palette);
  if (action === 'text') additions.push(input.value === 'heading' ? E.newHeading(color, frame) : input.value === 'subheading' ? E.newSubheading(color, frame) : E.newBody(color, frame));
  if (action === 'textStyle') additions.push(...(E.TEXT_STYLES.find(x => x.id === input.value)?.make(color, frame) ?? []));
  if (action === 'badge') additions.push(...(E.BADGES.find(x => x.id === input.value)?.make(color, frame) ?? []));
  if (action === 'shape') additions.push(['arrow', 'line', 'rect', 'circle'].includes(input.value) ? E.newShape(input.value, color) : E.newShapeOf(input.value, color, frame));
  if (action === 'line') additions.push(E.newLineStyle(input.value, color, frame));
  if (action === 'mark') additions.push(E.newCornerMark('wordmark', assets, frame, input.value === 'top'));
  if (action === 'image') additions.push(input.value ? E.newFrame(input.value, input.photoId, frame) : E.newImageLayer(input.photoId));
  if (action === 'link') additions.push(E.newLinkPill(input.value || 'Ask us on WhatsApp'));
  if (action === 'scale') doc.layers = doc.layers.map(l => selected.has(l.id) && !l.locked ? E.scaleLayer(l, input.factor) : l);
  if (action === 'align' || action === 'distribute') {
    const layers = doc.layers.filter(l => selected.has(l.id) && !l.locked);
    const boxes = layers.map(l => E.layerBox(l, fields, assets));
    const deltas = action === 'align' ? D.alignDeltas(boxes, input.value, input.toPage ? { x: 0, y: 0, ...frame } : undefined) : D.distributeDeltas(boxes, input.value);
    const moves = new Map(layers.map((l, i) => [l.id, deltas[i]]));
    doc.layers = doc.layers.map(l => { const d = moves.get(l.id); return d ? E.moveLayer(l, d.dx, d.dy) : l; });
  }
  if (additions.length) doc.layers.push(...additions);
  // The owner's full-logo preference applies to templates too.
  doc.layers = doc.layers.map(l => l.kind === 'wordmark' && l.mark === 't' ? { ...l, mark: 'wordmark', width: Math.max(210, l.width), x: Math.min(l.x, frame.w - 250) } : l);
  for (const l of doc.layers) if (l.kind === 'image' && l.src) await E.loadUpload(l.src);
  doc = E.reflow(doc, fields, assets);
  let background: HTMLImageElement | null = null;
  if (input.background) background = await loadImage(input.background);
  const canvas = E.renderDocTo(doc, fields, assets, Math.max(120, Math.min(3240, input.px ?? 540)), { background, hideBound: !!input.hideBound });
  const piece = input.piece ?? {};
  return JSON.parse(JSON.stringify({
    doc, image: canvas.toDataURL('image/jpeg', input.quality ?? .92).split(',')[1],
    boxes: doc.layers.map(l => ({ id: l.id, ...E.layerBox(l, fields, assets) })), added: additions.map(l => l.id),
    caption: whatsappCaption(piece, input.context ?? { whatsappNumbers: [] }), weight: weightLabel(piece), details: detailsLine(piece, false),
    names: Array.from({ length: input.count ?? 1 }, (_, i) => isMaisonFolder(input.folder) ? maisonFileName(input.maisonHouse ?? '', input.name ?? piece.headline ?? '', i) : websiteFileName(input.name ?? piece.headline ?? '', i)),
    catalogue: {
      plays: PLAYS, stages: STAGES, playbook: PLAYBOOK, maisonHouses: MAISON_HOUSES, presets: E.PRESETS, squares: E.SQUARE_PRESETS.filter(x => x.id !== 'catalogue-t'), palettes: PALETTES,
      fonts: Object.entries(E.FONT_LABEL).map(([id, label]) => ({ id, label })), effects: E.EFFECTS.map(x => ({ id: x.kind, label: x.label })),
      shapes: Object.entries(D.SHAPES).map(([id, v]) => ({ id, label: v.label })), masks: D.MASK_PICKS,
      filters: D.FILTERS, textStyles: E.TEXT_STYLES.map(({ id, label }) => ({ id, label })), badges: E.BADGES.map(({ id, label }) => ({ id, label })),
      formats: Object.entries(A.AD_FORMATS).map(([id, v]) => ({ id, ...v })), templates: A.AD_TEMPLATES, scenes: SCENES, brand: BRAND,
    },
  }));
}
(window as any).nativeDesign = run;
