import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.join(root, 'apps/iphone/App/Resources/Design');
await mkdir(out, { recursive: true });
const fonts = [
  ['Headline', 'sofia-sans-extra-condensed-latin', '800', 'normal'], ['Body', 'figtree-latin', '300 700', 'normal'],
  ['Didone', 'bodoni-moda-normal-latin', '400 500', 'normal'], ['Didone', 'bodoni-moda-italic-latin', '400 500', 'italic'],
  ['Cormorant', 'cormorant-garamond-normal-latin', '500', 'normal'], ['Cormorant', 'cormorant-garamond-italic-latin', '500', 'italic'],
  ['Playfair', 'playfair-display-latin', '700', 'normal'], ['Script', 'great-vibes-latin', '400', 'normal'],
  ['Montserrat', 'montserrat-latin', '400 700', 'normal'], ['Cinzel', 'cinzel-latin', '500', 'normal'],
];
let css = '';
for (const [name, file, weight, style] of fonts) {
  const data = await readFile(path.join(root, 'src/fonts', file + '.woff2'));
  css += `@font-face{font-family:'${name}';src:url(data:font/woff2;base64,${data.toString('base64')});font-weight:${weight};font-style:${style};}`;
}
const stamp = await readFile(path.join(root, 'public/fonts/futura-lt-light.woff2'));
css += `@font-face{font-family:'Taheri Stamp';src:url(data:font/woff2;base64,${stamp.toString('base64')});font-weight:300;}`;
for (const house of ['mina', 'taheri']) {
  const mark = 'data:image/svg+xml;base64,' + (await readFile(path.join(root, `public/brand/${house}-wordmark.svg`))).toString('base64');
  const result = await build({ absWorkingDir: root, entryPoints: ['apps/iphone/scripts/design-engine.ts'], bundle: true, minify: true, platform: 'browser', target: 'safari18', format: 'iife', write: false, define: { 'process.env': '{}', 'process.env.NEXT_PUBLIC_STORE_BRAND': JSON.stringify(house), NATIVE_FONTS: JSON.stringify(css), NATIVE_MARK: JSON.stringify(mark) } });
  await writeFile(path.join(out, `design-${house}.js`), result.outputFiles[0].contents);
}
console.log('Both houses’ artwork engines bundled with their full logos and fonts.');
