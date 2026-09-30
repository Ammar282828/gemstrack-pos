// Each house's icons: the browser tab, the phone's home screen, an installed app.
//
//   node scripts/make-icons.mjs      → public/icons/<brand>/…  (commit what it writes)
//
// Taheri: the t monogram (public/brand/taheri-t.svg, the same mark as taheri.shop's icon and the
// Meta app's) in white on taheri.shop's ground #0A1111. House of Mina: the interlocking monogram
// of catalogue.houseofmina.store's icon (public/brand/mina-monogram.png, and its bolder 64-px cut
// for the tab sizes, where the thin strokes would fade) in maroon #3A0000 on the catalogue's cream
// #FAF7F2. The layout links them by NEXT_PUBLIC_STORE_BRAND; /favicon.ico and
// /apple-touch-icon.png are rewritten to them in next.config.ts. Until 2026-09-30 both ERPs showed
// the project template's orange flame.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pub = (...p) => path.join(ROOT, 'public', ...p);

const HOUSES = {
  taheri: { ground: '#0A1111' },
  mina: { ground: '#FAF7F2' },
};

// The t, recoloured, as an SVG of its own bounds (viewBox from the file).
const tSvg = (await fs.readFile(pub('brand', 'taheri-t.svg'), 'utf8')).replace(/fill="#1a1a1a"/g, 'fill="#FFFFFF"');
const T_BOX = { w: 294.25, h: 585.75 };

/** A square icon: `size` px, the ground (rounded by `radius` of the side, 0 = full bleed), the mark scaled to `scale`. */
async function icon(brand, size, { radius = 0, scale = 0.7 } = {}) {
  const { ground } = HOUSES[brand];
  const r = Math.round(size * radius);
  const base = sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${ground}"/></svg>`));
  let mark;
  if (brand === 'taheri') {
    // scale = the t's height against the side.
    const h = Math.round(size * scale), w = Math.round((h * T_BOX.w) / T_BOX.h);
    mark = await sharp(Buffer.from(tSvg), { density: Math.max(72, Math.ceil((72 * h) / T_BOX.h) * 2) }).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  } else {
    // scale = the monogram's width against the side. Small sizes take the bold cut.
    const src = size <= 64 ? pub('brand', 'mina-monogram-bold.png') : pub('brand', 'mina-monogram.png');
    const w = Math.round(size * scale);
    mark = await sharp(await sharp(src).trim().toBuffer()).resize({ width: w }).png().toBuffer();
  }
  const m = await sharp(mark).metadata();
  return base.composite([{ input: mark, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }]).png().toBuffer();
}

/** A .ico holding PNGs (every browser since IE11 reads PNG entries). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const o = 6 + i * 16;
    head[o] = size >= 256 ? 0 : size; head[o + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(data.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

for (const brand of Object.keys(HOUSES)) {
  const dir = pub('icons', brand);
  await fs.mkdir(dir, { recursive: true });
  // The tab: a rounded tile, the mark large.
  const tab = brand === 'taheri' ? { radius: 0.22, scale: 0.74 } : { radius: 0.22, scale: 0.86 };
  const tabs = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await icon(brand, size, tab) })));
  await fs.writeFile(path.join(dir, 'favicon.ico'), ico(tabs));
  await fs.writeFile(path.join(dir, 'icon-192.png'), await icon(brand, 192, tab));
  await fs.writeFile(path.join(dir, 'icon-512.png'), await icon(brand, 512, tab));
  // The phone: full bleed (iOS and Android round it themselves); the maskable one keeps the mark
  // inside the middle 80% circle every launcher shape leaves whole.
  const phone = brand === 'taheri' ? { scale: 0.62 } : { scale: 0.74 };
  await fs.writeFile(path.join(dir, 'apple-touch-icon.png'), await icon(brand, 180, phone));
  await fs.writeFile(path.join(dir, 'maskable-512.png'), await icon(brand, 512, brand === 'taheri' ? { scale: 0.52 } : { scale: 0.62 }));
  console.log(`${brand}: favicon.ico (16/32/48), icon-192, icon-512, apple-touch-icon, maskable-512`);
}
