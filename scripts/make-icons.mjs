// Each house's icons: the browser tab, the phone's home screen, an installed app.
//
//   node scripts/make-icons.mjs      → public/icons/<brand>/…  (commit what it writes)
//                                      and the iPhone app's: apps/ios/ios/App/App/Assets.xcassets
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
  const mark = await markPng(brand, size, scale);
  const m = await sharp(mark).metadata();
  return base.composite([{ input: mark, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }]).png().toBuffer();
}

/** The house's mark alone, transparent around it, sized for a `size` px square at `scale`. */
async function markPng(brand, size, scale) {
  let mark;
  if (brand === 'taheri') {
    // scale = the t's height against the side.
    const h = Math.round(size * scale), w = Math.round((h * T_BOX.w) / T_BOX.h);
    mark = await sharp(Buffer.from(tSvg), { density: Math.max(72, Math.ceil((72 * h) / T_BOX.h) * 2) }).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  } else {
    // scale = the monogram's width against the side. Small sizes take the bold cut.
    const src = size <= 64 ? pub('brand', 'mina-monogram-bold.png') : pub('brand', 'mina-monogram.png');
    const w = Math.round(size * scale);
    mark = await sharp(await sharp(src).trim().toBuffer()).resize({ width: w, kernel: 'lanczos3' }).png().toBuffer();
  }
  return mark;
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

// The iPhone app (apps/ios): its icon, a 1024 full-bleed square with no transparency (App Store
// Connect refuses an icon with an alpha channel; iOS rounds it), and the launch screen's ground
// and mark (Info.plist UILaunchScreen, chosen per house by scripts/house.mjs).
const XC = path.join(ROOT, 'apps', 'ios', 'ios', 'App', 'App', 'Assets.xcassets');
const xcInfo = { author: 'xcode', version: 1 };
const writeJson = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
const rgb = (hex) => [1, 3, 5].map((i) => `0x${hex.slice(i, i + 2).toUpperCase()}`);
for (const brand of Object.keys(HOUSES)) {
  const phone = brand === 'taheri' ? { scale: 0.62 } : { scale: 0.74 };
  const iconDir = path.join(XC, `AppIcon-${brand}.appiconset`);
  await fs.mkdir(iconDir, { recursive: true });
  await fs.writeFile(path.join(iconDir, 'icon-1024.png'), await sharp(await icon(brand, 1024, phone)).flatten({ background: HOUSES[brand].ground }).removeAlpha().png().toBuffer());
  await writeJson(path.join(iconDir, 'Contents.json'), { images: [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: xcInfo });

  const colorDir = path.join(XC, `Launch-${brand}.colorset`);
  await fs.mkdir(colorDir, { recursive: true });
  const [red, green, blue] = rgb(HOUSES[brand].ground);
  await writeJson(path.join(colorDir, 'Contents.json'), { colors: [{ color: { 'color-space': 'srgb', components: { alpha: '1.000', red, green, blue } }, idiom: 'universal' }], info: xcInfo });

  // The mark at 120 pt across the middle of the launch screen, as the home-screen icon has it.
  const markDir = path.join(XC, `LaunchMark-${brand}.imageset`);
  await fs.mkdir(markDir, { recursive: true });
  const images = [];
  for (const scale of [1, 2, 3]) {
    const file = `mark@${scale}x.png`;
    await fs.writeFile(path.join(markDir, file), await markPng(brand, 120 * scale, brand === 'taheri' ? 0.62 : 0.74));
    images.push({ filename: file, idiom: 'universal', scale: `${scale}x` });
  }
  await writeJson(path.join(markDir, 'Contents.json'), { images, info: xcInfo });
  console.log(`${brand}: iPhone app icon (1024), launch colour and mark`);
}
