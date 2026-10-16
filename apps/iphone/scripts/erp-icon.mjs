// The one app's primary icon, AppIcon-erp: a brilliant-cut diamond seen from the side, in thin champagne-gold strokes on deep ink.
// Run from the repo root or here:  node apps/iphone/scripts/erp-icon.mjs [--preview <out.png>]
// Writes icon-1024.png (any, opaque), icon-1024-dark.png and icon-1024-tinted.png (white on transparent) + Contents.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../package.json'));
const sharp = require('sharp');
const dir = path.join(here, '../App/Resources/Assets.xcassets/AppIcon-erp.appiconset');

// Geometry (1024 canvas). The mark is 540 wide and 420 tall, centred on the canvas; the stones' optical centre sits a touch high.
const S = 1024, CX = 512;
const W = 540, HALF = W / 2;              // girdle, 52.7% of the canvas
const TABLE = 134;                         // table half-width
const TOP = 304, GIRDLE = 438, APEX = 724; // crown 134 tall, pavilion 286
const SW = 9;                              // one stroke weight everywhere
const L = [CX - HALF, GIRDLE], R = [CX + HALF, GIRDLE];
const A = [CX - TABLE, TOP], B = [CX + TABLE, TOP];
const apex = [CX, APEX];
const g1 = [CX - 112, GIRDLE], g2 = [CX + 112, GIRDLE];   // where the crown's star facets meet the girdle, and the pavilion's two lines start
const pts = (...p) => p.map((q) => q.join(',')).join(' ');
const line = (a, b) => `M${a.join(' ')}L${b.join(' ')}`;

const marks = [
  // outline: table, crown sides, pavilion sides
  `<polygon points="${pts(A, B, R, apex, L)}"/>`,
  // girdle
  `<path d="${line(L, R)}"/>`,
  // crown facets: a zigzag of star facets from the table corners and its middle down to the girdle
  `<path d="${line(A, g1)}"/><path d="${line(B, g2)}"/>`,
  `<path d="${line([CX, TOP], g1)}"/><path d="${line([CX, TOP], g2)}"/>`,
  // pavilion facets
  `<path d="${line(g1, apex)}"/><path d="${line(g2, apex)}"/>`,

].join('');

function svg({ bg, stroke, defs = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>${defs}</defs>${bg}
<g fill="none" stroke="${stroke}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round">${marks}</g></svg>`;
}
const gold = `<linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="0" y1="${TOP}" x2="0" y2="${APEX}"><stop offset="0" stop-color="#C9A876"/><stop offset="1" stop-color="#A8885A"/></linearGradient>`;
const ink = `<linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B1213"/><stop offset="1" stop-color="#0B1213"/></linearGradient>
<radialGradient id="lift" gradientUnits="userSpaceOnUse" cx="512" cy="0" r="900"><stop offset="0" stop-color="#121C1D"/><stop offset="1" stop-color="#0B1213"/></radialGradient>`;

const light = svg({ defs: gold + ink, bg: `<rect width="${S}" height="${S}" fill="url(#lift)"/>`, stroke: 'url(#gold)' });
const dark = svg({ defs: gold, bg: `<rect width="${S}" height="${S}" fill="#050808"/>`, stroke: 'url(#gold)' });
const tinted = svg({ bg: '', stroke: '#FFFFFF' });

const png = (s, { alpha }) => {
  let p = sharp(Buffer.from(s), { density: 72 }).resize(S, S);
  if (!alpha) p = p.flatten({ background: '#0B1213' }).removeAlpha();
  return p.png({ compressionLevel: 9 }).toBuffer();
};

const out = { 'icon-1024.png': await png(light, { alpha: false }), 'icon-1024-dark.png': await png(dark, { alpha: false }), 'icon-1024-tinted.png': await png(tinted, { alpha: true }) };
await fs.mkdir(dir, { recursive: true });
for (const [f, b] of Object.entries(out)) await fs.writeFile(path.join(dir, f), b);
const entry = (filename, value) => { const e = { ...(value ? { appearances: [{ appearance: 'luminosity', value }] } : {}), filename, idiom: 'universal', platform: 'ios', size: '1024x1024' }; return e; };
const contents = { images: [entry('icon-1024.png'), entry('icon-1024-dark.png', 'dark'), entry('icon-1024-tinted.png', 'tinted')], info: { author: 'xcode', version: 1 } };
await fs.writeFile(path.join(dir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
console.log('wrote', dir);

const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  const target = process.argv[pi + 1];
  const T = 360, card = 460, W2 = 3 * card + 4 * 40, H2 = 760;
  const round = (px, r) => sharp(px).resize(T, T).composite([{ input: Buffer.from(`<svg width="${T}" height="${T}"><rect width="${T}" height="${T}" rx="${T * 0.2237}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
  const tintedTile = await sharp({ create: { width: S, height: S, channels: 4, background: '#2A2A2C' } }).composite([{ input: out['icon-1024-tinted.png'] }]).png().toBuffer();
  const tiles = [await round(out['icon-1024.png']), await round(out['icon-1024-dark.png']), await round(tintedTile)];
  const comp = tiles.map((t, i) => ({ input: t, left: 40 + i * (card + 40) + (card - T) / 2, top: 50 }));
  const sizes = [180, 120, 60];
  let x = 60;
  for (const s of sizes) {
    const r = await sharp(out['icon-1024.png']).resize(s, s).composite([{ input: Buffer.from(`<svg width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${s * 0.2237}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
    comp.push({ input: r, left: x, top: 480 }); x += s + 40;
  }
  // on a wallpaper-ish strip beside the others
  const strip = await sharp({ create: { width: 560, height: 220, channels: 4, background: '#6C7A89' } }).png().toBuffer();
  comp.splice(3, 0, { input: strip, left: 40, top: 450 });
  await sharp({ create: { width: W2, height: H2, channels: 4, background: '#8B8B8E' } }).composite(comp).png().toFile(target);
  console.log('preview', target);
}
