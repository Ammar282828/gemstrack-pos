// Native branding comes from the ERP's full logos, including its light-on-dark cuts.
// Run from any folder: node apps/iphone/scripts/branding.mjs [house…] (no house: every house).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const assets = path.join(root, 'apps/iphone/App/Resources/Assets.xcassets');
const info = { author: 'xcode', version: 1 };
const houses = {
  // darkIcon: the ground of the home screen's dark (and tinted) icon, drawn with the light-on-dark logo.
  // Mina's is its dark ground (Ground-mina, dark); Taheri's icon is already the light cut on dark.
  mina: { file: 'house-of-mina-logo', ground: '#FAF7F2', darkLaunch: false, darkIcon: '#1C1114' },
  taheri: { file: 'taheri-logo', ground: '#0A1111', darkLaunch: true },
};
const only = process.argv.slice(2);

/** The logo across 820 of the icon's 1024, centred on a flat ground. */
async function icon(logo, ground, out, { grey = false } = {}) {
  let mark = sharp(logo).resize({ width: 820 });
  const wordmark = await mark.toBuffer();
  const { width, height } = await sharp(wordmark).metadata();
  let img = sharp({ create: { width: 1024, height: 1024, channels: 3, background: ground } })
    .composite([{ input: wordmark, left: Math.round((1024 - width) / 2), top: Math.round((1024 - height) / 2) }])
    .removeAlpha();
  if (grey) img = sharp(await img.png().toBuffer()).grayscale();
  await img.png().toFile(out);
}

for (const [house, brand] of Object.entries(houses)) {
  if (only.length && !only.includes(house)) continue;
  const logo = path.join(root, 'public', `${brand.file}.png`);
  const lightLogo = path.join(root, 'public', `${brand.file}-light.png`);
  const logoDir = path.join(assets, `BrandLogo-${house}.imageset`);
  await fs.mkdir(logoDir, { recursive: true });
  await fs.copyFile(logo, path.join(logoDir, 'logo.png'));
  await fs.copyFile(lightLogo, path.join(logoDir, 'logo-dark.png'));
  await fs.writeFile(path.join(logoDir, 'Contents.json'), JSON.stringify({
    images: [
      { idiom: 'universal', filename: 'logo.png' },
      { idiom: 'universal', filename: 'logo-dark.png', appearances: [{ appearance: 'luminosity', value: 'dark' }] },
    ], info,
  }, null, 2) + '\n');

  const launch = brand.darkLaunch ? lightLogo : logo;
  // The launch mark in both appearances: `mark@` is the house's own launch cut (light-on-dark for a dark
  // launch), and the other appearance gets the opposite cut, so a light phone never shows white on light.
  const other = brand.darkLaunch ? logo : lightLogo;
  const otherName = brand.darkLaunch ? 'mark-light' : 'mark-dark';
  const launchDir = path.join(assets, `LaunchLogo-${house}.imageset`);
  const launchImages = [];
  for (const scale of [1, 2, 3]) {
    await sharp(launch).resize({ width: 256 * scale }).png().toFile(path.join(launchDir, `mark@${scale}x.png`));
    await sharp(other).resize({ width: 256 * scale }).png().toFile(path.join(launchDir, `${otherName}@${scale}x.png`));
    const dark = { appearances: [{ appearance: 'luminosity', value: 'dark' }] };
    const own = { filename: `mark@${scale}x.png`, idiom: 'universal', scale: `${scale}x` };
    const opposite = { filename: `${otherName}@${scale}x.png`, idiom: 'universal', scale: `${scale}x` };
    launchImages.push(...(brand.darkLaunch ? [opposite, { ...own, ...dark }] : [own, { ...opposite, ...dark }]));
  }
  await fs.writeFile(path.join(launchDir, 'Contents.json'), JSON.stringify({ images: launchImages, info }, null, 2) + '\n');
  const iconDir = path.join(assets, `AppIcon-${house}.appiconset`);
  await icon(launch, brand.ground, path.join(iconDir, 'icon-1024.png'));
  const images = [{ filename: 'icon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }];
  if (brand.darkIcon) {
    // iOS 18's dark and tinted home screens. Tinted is the same light logo on black, in greys: the
    // system lays its tint over the luminance.
    await icon(lightLogo, brand.darkIcon, path.join(iconDir, 'icon-1024-dark.png'));
    await icon(lightLogo, '#000000', path.join(iconDir, 'icon-1024-tinted.png'), { grey: true });
    for (const [value, filename] of [['dark', 'icon-1024-dark.png'], ['tinted', 'icon-1024-tinted.png']]) {
      images.push({ appearances: [{ appearance: 'luminosity', value }], filename, idiom: 'universal', platform: 'ios', size: '1024x1024' });
    }
  }
  await fs.writeFile(path.join(iconDir, 'Contents.json'), JSON.stringify({ images, info }, null, 2) + '\n');
}
