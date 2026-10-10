// Native branding comes from the ERP's full logos, including its light-on-dark cuts.
// Run from any folder: node apps/iphone/scripts/branding.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const assets = path.join(root, 'apps/iphone/App/Resources/Assets.xcassets');
const info = { author: 'xcode', version: 1 };
const houses = {
  mina: { file: 'house-of-mina-logo', ground: '#FAF7F2', darkLaunch: false },
  taheri: { file: 'taheri-logo', ground: '#0A1111', darkLaunch: true },
};

for (const [house, brand] of Object.entries(houses)) {
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
  for (const scale of [1, 2, 3]) {
    await sharp(launch).resize({ width: 256 * scale }).png()
      .toFile(path.join(assets, `LaunchLogo-${house}.imageset`, `mark@${scale}x.png`));
  }
  const wordmark = await sharp(launch).resize({ width: 820 }).toBuffer();
  const { width, height } = await sharp(wordmark).metadata();
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: brand.ground } })
    .composite([{ input: wordmark, left: Math.round((1024 - width) / 2), top: Math.round((1024 - height) / 2) }])
    .removeAlpha().png().toFile(path.join(assets, `AppIcon-${house}.appiconset`, 'icon-1024.png'));
}
