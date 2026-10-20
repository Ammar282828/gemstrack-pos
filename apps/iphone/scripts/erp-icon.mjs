// The one app's primary icon, AppIcon-erp: a filled brilliant-cut gemstone (table, crown, girdle, pavilion), every facet its own
// gradient, lit from the top-left, on deep teal-ink with a warm glow and a four-point glint. All procedural SVG, no assets.
// Run from the repo root or here:  node apps/iphone/scripts/erp-icon.mjs [--preview <sheet.png>]
// Writes icon-1024.png (opaque), icon-1024-dark.png (opaque), icon-1024-tinted.png (white on transparent) + Contents.json.
// --preview also writes a contact sheet (light/dark/tinted at 256, 180, 60 px) and sibling preview-1024/180/60.png next to it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../package.json'));
const sharp = require('sharp');
const dir = path.join(here, '../App/Resources/Assets.xcassets/AppIcon-erp.appiconset');

// ---- Geometry (1024 canvas). Stone 656 wide (64%), 250..745 tall; its middle sits just above the canvas middle. ----
const S = 1024, CX = 512;
const P = (x, y) => [CX + x, y];                 // x is an offset from the centre line
const GX = 640;
const TOP = 250, MID = 310, GC = 404, GP = 424, APEX = 745, KY = 560, QY = 590;
const HALF = 328, TW = 150, TW2 = 100, G1 = 170;
const L = P(-HALF, GC), R = P(HALF, GC), Lp = P(-HALF, GP), Rp = P(HALF, GP);
const A = P(-TW, TOP), B = P(TW, TOP), A2 = P(-TW2, MID), B2 = P(TW2, MID);
const g1 = P(-G1, GC), g2 = P(G1, GC), c = P(0, GC);
const sx = 242;                                   // where the crown's side edge is at y=330
const SL = P(-sx, 330), SR = P(sx, 330);
const p1 = P(-G1, GP), p2 = P(0, GP), p3 = P(G1, GP);
const apex = P(0, APEX);
const k0 = P(-189, KY), k0r = P(189, KY), k1 = P(-G1 + G1 * (KY - GP) / (APEX - GP), KY), k1r = P(G1 - G1 * (KY - GP) / (APEX - GP), KY);

// ---- Colour helpers ----
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const ramp = (kind, t) => kind === 'c'
  ? [lerp('#D8B57A', '#FFF4DC', t), lerp('#A8854F', '#E6C892', t)]
  : kind === 'g'
    ? [lerp('#B48B4E', '#F0DDB0', t), lerp('#7A5A2C', '#C9A876', t)]
    : [lerp('#7A5A2C', '#E9C98C', t), lerp('#4A3719', '#8E6A36', t)];

// Facets: [name, kind, tone 0..1 (1 = catching the light), gradient angle in degrees (0 = left to right, 90 = top to bottom), points, reflection?]
const F = [
  // crown
  ['table', 'c', 1.0, 60, [A, B, B2, A2]],
  ['starL', 'c', 1.0, 70, [A, A2, SL]],
  ['bezL', 'c', 0.3, 40, [SL, A2, g1]],
  ['ugL', 'c', 0.85, 30, [SL, g1, L]],
  ['midL', 'c', 0.95, 110, [A2, c, g1]],
  ['mid', 'c', 0.05, 90, [A2, B2, c]],
  ['midR', 'c', 0.7, 70, [B2, g2, c]],
  ['bezR', 'c', 1.0, 140, [SR, g2, B2]],
  ['starR', 'c', 0.15, 110, [B, SR, B2]],
  ['ugR', 'c', 0.1, 150, [SR, R, g2]],
  // girdle band
  ['gL', 'g', 0.9, 0, [L, g1, p1, Lp]],
  ['gML', 'g', 0.6, 0, [g1, c, p2, p1]],
  ['gMR', 'g', 0.45, 0, [c, g2, p3, p2]],
  ['gR', 'g', 0.25, 0, [g2, R, Rp, p3]],
  // pavilion
  ['lgL', 'p', 0.1, 40, [Lp, p1, k0]],
  ['pkL', 'p', 1.0, 50, [p1, k1, k0], true],
  ['kaL', 'p', 0.8, 60, [k0, k1, apex], true],
  ['mainL', 'p', 0.9, 70, [p1, p2, apex], true],
  ['mainR', 'p', 0.12, 100, [p2, p3, apex]],
  ['kaR', 'p', 0.7, 120, [k0r, k1r, apex]],
  ['pkR', 'p', 0.05, 150, [p3, k1r, k0r], true],
  ['lgR', 'p', 0.05, 130, [Rp, p3, k0r]],
];
const pts = (a) => a.map((q) => q.map((v) => +v.toFixed(1)).join(',')).join(' ');
const dirOf = (deg) => { const r = (deg * Math.PI) / 180, dx = Math.cos(r) / 2, dy = Math.sin(r) / 2; return `x1="${(0.5 - dx).toFixed(3)}" y1="${(0.5 - dy).toFixed(3)}" x2="${(0.5 + dx).toFixed(3)}" y2="${(0.5 + dy).toFixed(3)}"`; };

function stone(mode) {
  let defs = '', body = '';
  F.forEach(([n, kind, t, ang, poly, refl], i) => {
    const [c0, c1] = ramp(kind, t);
    if (mode === 'tinted') {
      const o = (0.35 + 0.6 * t).toFixed(2);
      body += `<polygon points="${pts(poly)}" fill="#fff" fill-opacity="${o}"/>`;
      return;
    }
    defs += `<linearGradient id="f${i}" ${dirOf(ang)}><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>`;
    body += `<polygon points="${pts(poly)}" fill="url(#f${i})"/>`;
    if (refl) {
      defs += `<linearGradient id="r${i}" ${dirOf(ang - 25)}><stop offset="0" stop-color="#FFF1D0" stop-opacity="0.7"/><stop offset="0.7" stop-color="#FFF1D0" stop-opacity="0"/></linearGradient>`;
      body += `<polygon points="${pts(poly)}" fill="url(#r${i})"/>`;
    }
  });
  if (mode === 'tinted') return { defs, body };
  const poly = (a) => `<polygon points="${pts(a)}"/>`;
  body += `<g fill="#DDE8E6" fill-opacity="0.15">${poly(F.find((f) => f[0] === 'bezL')[4])}${poly(F.find((f) => f[0] === 'kaR')[4])}</g>`;
  body += `<g fill="#fff" fill-opacity="0.8">${poly([P(-118, 262), P(-60, 262), P(-92, 296), P(-132, 296)])}${poly([P(62, 270), P(80, 270), P(52, 300), P(40, 300)])}</g>`;
  const edges = F.map(([, , , , poly]) => `<polygon points="${pts(poly)}"/>`).join('');
  body += `<g fill="none" stroke="#FFF6E0" stroke-opacity="0.35" stroke-width="2.5" stroke-linejoin="round">${edges}</g>`;
  body += `<g fill="none" stroke-linecap="round"><path d="M${L.join(' ')}L${R.join(' ')}" stroke="#FFF6E0" stroke-opacity="0.7" stroke-width="3.5"/><path d="M${A.join(' ')}L${B.join(' ')}" stroke="#FFFBEA" stroke-opacity="0.75" stroke-width="3"/></g>`;
  return { defs, body };
}

// A four-point glint: long thin arms, concave sides.
const star = (x, y, r, w = 0.065) => `M${x} ${y - r}Q${x + r * w} ${y - r * w} ${x + r} ${y}Q${x + r * w} ${y + r * w} ${x} ${y + r}Q${x - r * w} ${y + r * w} ${x - r} ${y}Q${x - r * w} ${y - r * w} ${x} ${y - r}Z`;

function svg(mode) {
  const { defs: sd, body } = stone(mode);
  if (mode === 'tinted') return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><defs>${sd}</defs>${body}<path d="${star(GX, B[1], 44, 0.045)}" fill="#fff"/></svg>`;
  const dark = mode === 'dark';
  const glowA = dark ? 0.34 : 0.26;
  const bgDefs = dark
    ? `<radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="512" cy="330" r="880"><stop offset="0" stop-color="#0A1213"/><stop offset="0.55" stop-color="#050A0B"/><stop offset="1" stop-color="#030505"/></radialGradient>`
    : `<radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="512" cy="240" r="900"><stop offset="0" stop-color="#183634"/><stop offset="0.5" stop-color="#0A1213"/><stop offset="1" stop-color="#050909"/></radialGradient>`;
  const defs = `${bgDefs}${sd}
<linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1024" y2="1024"><stop offset="0.25" stop-color="#fff" stop-opacity="0"/><stop offset="0.42" stop-color="#fff" stop-opacity="${dark ? 0.025 : 0.05}"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="512" cy="500" r="400"><stop offset="0" stop-color="#E0B068" stop-opacity="${glowA}"/><stop offset="0.55" stop-color="#E0B068" stop-opacity="${glowA * 0.4}"/><stop offset="1" stop-color="#E0B068" stop-opacity="0"/></radialGradient>
<radialGradient id="under" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#C9A876" stop-opacity="0.38"/><stop offset="1" stop-color="#C9A876" stop-opacity="0"/></radialGradient>
<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.95"/><stop offset="0.25" stop-color="#FFF1D0" stop-opacity="0.5"/><stop offset="1" stop-color="#FFF1D0" stop-opacity="0"/></radialGradient>
<filter id="blur40" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
<filter id="blur14" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="blur3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.9 0.9 0.9 0 -0.9"/></filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><defs>${defs}</defs>
<rect width="${S}" height="${S}" fill="url(#bg)"/>
<rect width="${S}" height="${S}" fill="url(#sheen)"/>
<rect width="${S}" height="${S}" filter="url(#grain)" opacity="0.025"/>
<ellipse cx="512" cy="500" rx="340" ry="300" fill="url(#glow)" filter="url(#blur40)"/>
<g>${body}</g>
<circle cx="${GX}" cy="${B[1]}" r="46" fill="url(#halo)" filter="url(#blur3)"/>
<path d="${star(GX, B[1], 44, 0.045)}" fill="#fff"/>
<path d="${star(GX, B[1], 22, 0.06)}" fill="#fff" transform="rotate(45 ${GX} ${B[1]})" opacity="0.7"/>
<circle cx="${GX}" cy="${B[1]}" r="4.5" fill="#fff"/>
</svg>`;
}

const png = (s, { alpha }) => {
  let p = sharp(Buffer.from(s), { density: 72 }).resize(S, S);
  if (!alpha) p = p.flatten({ background: '#0B1213' }).removeAlpha();
  return p.png({ compressionLevel: 9 }).toBuffer();
};

const out = { 'icon-1024.png': await png(svg('light'), { alpha: false }), 'icon-1024-dark.png': await png(svg('dark'), { alpha: false }), 'icon-1024-tinted.png': await png(svg('tinted'), { alpha: true }) };
await fs.mkdir(dir, { recursive: true });
for (const [f, b] of Object.entries(out)) await fs.writeFile(path.join(dir, f), b);
const entry = (filename, value) => ({ ...(value ? { appearances: [{ appearance: 'luminosity', value }] } : {}), filename, idiom: 'universal', platform: 'ios', size: '1024x1024' });
const contents = { images: [entry('icon-1024.png'), entry('icon-1024-dark.png', 'dark'), entry('icon-1024-tinted.png', 'tinted')], info: { author: 'xcode', version: 1 } };
await fs.writeFile(path.join(dir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
console.log('wrote', dir);

const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  const target = process.argv[pi + 1];
  const outDir = path.dirname(target);
  const tintedTile = await sharp({ create: { width: S, height: S, channels: 4, background: '#5A5A5E' } }).composite([{ input: out['icon-1024-tinted.png'] }]).png().toBuffer();
  const srcs = [out['icon-1024.png'], out['icon-1024-dark.png'], tintedTile];
  const rounded = (px, s) => sharp(px).resize(s, s).composite([{ input: Buffer.from(`<svg width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${s * 0.2237}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
  const sizes = [256, 180, 60], pad = 40, colW = 256 + pad, rowH = [256, 180, 60].map((s) => s + pad);
  const W2 = pad + 3 * colW, H2 = pad + rowH.reduce((a, b) => a + b, 0);
  const comp = []; let y = pad;
  for (let r = 0; r < sizes.length; r++) {
    for (let c2 = 0; c2 < 3; c2++) comp.push({ input: await rounded(srcs[c2], sizes[r]), left: pad + c2 * colW + (256 - sizes[r]) / 2, top: y });
    y += rowH[r];
  }
  await sharp({ create: { width: W2, height: H2, channels: 4, background: '#8B8B8E' } }).composite(comp).png().toFile(target);
  await fs.writeFile(path.join(outDir, 'preview-1024.png'), out['icon-1024.png']);
  for (const s of [180, 60]) await fs.writeFile(path.join(outDir, `preview-${s}.png`), await rounded(out['icon-1024.png'], s));
  console.log('preview', target);
}
