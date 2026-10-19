/** The app's local artwork engine. Only pixels and documents cross this bridge; all controls are SwiftUI. */
import * as E from '../../../src/lib/social/editor';
import * as D from '../../../src/lib/social/design';
import * as A from '../../../src/lib/ads/studio/templates';
import { PALETTES } from '../../../src/lib/social/palettes';
import { loadImage, stampPhoto } from '../../../src/lib/social/story';
import { siteStoryJpeg, HOUSE_STORY_COLOURS } from '../../../src/lib/social/site-story';
import { SCENES } from '../../../src/lib/social/prompts';
import { isMaisonFolder, maisonFileName, MAISON_HOUSES } from '../../../src/lib/website/maisons';
import { PLAYS, STAGES } from '../../../src/lib/ads/studio/plays';
import { PLAYBOOK } from '../../../src/lib/ads/studio/playbook';
import { BRAND } from '../../../src/lib/ads/studio/brand';
import { resizeOne, swapPhoto } from '../../../src/lib/design/resize';
import { mergePlan, planOf, summariseLayers } from '../../../src/lib/design/resize-ai';
import { wordProblems } from '../../../src/lib/design/publish';
import { makeMeasure } from '../../../src/lib/design/score';
import { weightLabel, detailsLine, whatsappCaption, websiteFileName, sitePieceCaption } from '../../../src/lib/social/caption';
import { subjectOf } from '../../../src/lib/social/subject';
import { siteDetailsLine, siteLayouts, siteStartLayout } from '../../../src/lib/social/site-design';

declare const NATIVE_MARK: string;
declare const NATIVE_FONTS: string;
const fonts: E.FontFamilies = { headline: 'Headline', body: 'Body', serif: 'Didone', extra: { cormorant: 'Cormorant', playfair: 'Playfair', script: 'Script', montserrat: 'Montserrat', cinzel: 'Cinzel', cormorantInfant: 'CormorantInfant', italiana: 'Italiana', jost: 'Jost', tenor: 'TenorSans', dmSerif: 'DMSerif', marcellus: 'Marcellus' } };
const ready = (async () => {
  const style = document.createElement('style'); style.textContent = NATIVE_FONTS; document.head.appendChild(style);
  await Promise.all(['800 100px Headline', '300 40px Body', '400 40px Body', '700 40px Body', '500 40px Didone', 'italic 400 40px Didone', '300 40px "Taheri Stamp"', '500 40px Cormorant', 'italic 500 40px Cormorant', '700 40px Playfair', '400 40px Script', '400 40px Montserrat', '700 40px Montserrat', '500 40px Cinzel', '500 40px CormorantInfant', '400 40px Italiana', '400 40px Jost', '400 40px TenorSans', '400 40px DMSerif', '400 40px Marcellus'].map(f => document.fonts.load(f)));
  return loadImage(NATIVE_MARK);
})();
const images = new Map<string, { src: string; img: HTMLImageElement }>();
/** A drawn JPEG as the base64 the bridge carries. */
const base64Of = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});
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
  // A website photograph (Edit a piece) takes the site's own mark ink (store-config STORE_SITE_MARK_INK): the catalogue's maroon.
  const ink = input.site ? (input.house === 'mina' ? '#3A0000' : '#111111') : input.house === 'mina' ? '#540000' : '#111111';
  const assets: E.Assets = { photos, marks: { wordmark: mark }, fonts, ink };
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
  // Resize (design.md "AI resize"): the same pure engine the web's resize sheet runs, so the phone and the web lay a design out alike.
  // 'resize' answers every target frame at once with the three deterministic layouts' winner plus what the AI step is shown (layer
  // summaries, the plan, a small JPEG); 'resizeMerge' lays the route's plans on those results and keeps one only if it scores as well.
  // The Publish sheet's house rules on the words about to go out (publish.ts wordProblems): sale words, hashtags, figures the specs don't give.
  if (action === 'words') return { problems: wordProblems(input.texts ?? {}, input.facts ?? '') };
  // Edit a piece's photograph and the Posts tray's Crop & design (site-design.ts): the layouts this house's website photo offers
  // and the one a design starts on (with the weight, `weightOn`, where the tray's card was stamping it).
  // The phone draws no monogram (every t becomes the full logo below), so the t's layout is never offered.
  if (action === 'siteLayouts') {
    const house = input.house === 'mina' ? 'mina' : 'taheri';
    return { layouts: siteLayouts(house, false), start: siteStartLayout(house, { photoSource: input.sitePiece?.photoSource ?? null, sourceMarked: !!input.sitePiece?.sourceMarked }, !!input.weightOn) };
  }
  // The Posts tray (src/app/posts/piece-card.tsx): a website piece's house caption (sitePieceCaption), its photo with the
  // weight in the catalogue's own lettering (stampPhoto), and its 9:16 story (site-story.ts), so the phone sends what the web's tray does.
  if (action === 'siteCaption') return { caption: sitePieceCaption(input.sitePiece ?? { name: '', url: '' }, input.context ?? { whatsappNumbers: [] }) };
  if (action === 'stamp' || action === 'siteStory') {
    const photo = photos[input.photoId] ?? Object.values(photos)[0];
    if (!photo) throw new Error('No photo to draw on.');
    if (action === 'stamp') return { image: await base64Of(await stampPhoto(photo, { text: input.text ?? '', colour: input.colour ?? 'auto', maxEdge: 2048 })) };
    // The Maisons are the great houses' pieces, not the house's own metal (siteDetailsLine).
    const details = siteDetailsLine(input.collection ?? '', input.metal ?? '', input.weight ?? '');
    const colours = HOUSE_STORY_COLOURS[input.house === 'mina' ? 'mina' : 'taheri'];
    return { image: await base64Of(await siteStoryJpeg(photo, { headline: input.headline ?? '', details }, { marks: mark ? { wordmark: mark } : {}, fonts }, colours)) };
  }
  if (action === 'resize' || action === 'resizeMerge') {
    const m = makeMeasure(fields, assets);
    const rates = input.rates?.rows ? input.rates : input.rates ? A.rateBoard(input.rates, new Date().toLocaleDateString('en-GB', {weekday:'long',day:'numeric',month:'long',timeZone:'Asia/Karachi'})) : null;
    const subject = input.subject ?? undefined;
    if (action === 'resizeMerge') {
      const merged = (input.items ?? []).map((it: any) => mergePlan(it.det, it.plan ?? null, fields, assets, { subject, measure: m }));
      return JSON.parse(JSON.stringify({ results: merged }));
    }
    const jpeg = (d: E.StoryDoc) => {
      try { return E.renderDocTo(E.reflow(d, fields, assets), fields, assets, 256, {}).toDataURL('image/jpeg', 0.6).split(',')[1]; } catch { return undefined; }
    };
    const from = input.swap?.from && input.swap?.to ? swapPhoto(doc, input.swap.from, input.swap.to) : doc;
    const opts = { subject, rates, photoMarked: !!input.photoMarked, measure: m };
    const results = (input.targets ?? []).map((tf: { w: number; h: number }) => {
      const r = resizeOne(from, fields, assets, tf, opts);
      return { ...r, ai: { layers: summariseLayers(r.doc, fields, m), plan: planOf(r, fields, m), thumb: jpeg(r.doc) } };
    });
    return JSON.parse(JSON.stringify({ source: { frame, layers: summariseLayers(doc, fields, m), thumb: jpeg(doc) }, results }));
  }
  const additions: E.Layer[] = [];
  // Subject-aware stories (subject.ts): a preset or story ad keeps its words off the piece. The engine looks for the piece in
  // the photo itself (kept in doc.meta.found); an app that knows better sends `subject` ({x,y,w,h}, 0…1 of the photo), which wins.
  if (input.subject && (action === 'preset' || action === 'ad')) doc.meta = { ...doc.meta, subject: input.subject };
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
  // A caller that draws a design (the Studio, its board) sends no piece: the caption is then empty, not a throw.
  const piece = { headline: '', ...(input.piece ?? {}) };
  return JSON.parse(JSON.stringify({
    doc, subject: subjectOf(doc, assets), image: canvas.toDataURL('image/jpeg', input.quality ?? .92).split(',')[1],
    boxes: doc.layers.map(l => ({ id: l.id, ...E.layerBox(l, fields, assets) })), added: additions.map(l => l.id),
    caption: whatsappCaption(piece, input.context ?? { whatsappNumbers: [] }), weight: weightLabel(piece), details: detailsLine(piece, false),
    names: Array.from({ length: input.count ?? 1 }, (_, i) => isMaisonFolder(input.folder) ? maisonFileName(input.maisonHouse ?? '', input.name ?? piece.headline ?? '', i) : websiteFileName(input.name ?? piece.headline ?? '', i)),
    catalogue: {
      plays: PLAYS, stages: STAGES, playbook: PLAYBOOK, maisonHouses: MAISON_HOUSES, presets: E.PRESETS, squares: E.SQUARE_PRESETS.filter(x => x.id !== 'catalogue-t'), siteSquares: siteLayouts(input.house === 'mina' ? 'mina' : 'taheri', false), palettes: PALETTES,
      fonts: Object.entries(E.FONT_LABEL).map(([id, label]) => ({ id, label })), effects: E.EFFECTS.map(x => ({ id: x.kind, label: x.label })),
      shapes: Object.entries(D.SHAPES).map(([id, v]) => ({ id, label: v.label })), masks: D.MASK_PICKS,
      filters: D.FILTERS, textStyles: E.TEXT_STYLES.map(({ id, label }) => ({ id, label })), badges: E.BADGES.map(({ id, label }) => ({ id, label })),
      formats: Object.entries(A.AD_FORMATS).map(([id, v]) => ({ id, ...v })), templates: A.AD_TEMPLATES, scenes: SCENES, brand: BRAND,
    },
  }));
}
(window as any).nativeDesign = run;
