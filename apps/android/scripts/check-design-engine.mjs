#!/usr/bin/env node
// Runs the designer engine's real bundle (apps/iphone/App/Resources/Design/design-<house>.js) in headless Chromium with the exact page and
// the exact messages the Android app builds, to prove the protocol (DesignProtocol.kt), the bundle and the Design screens agree.
//
//   1. ./gradlew :app:testTaheriDebugUnitTest --tests 'erp.app.screens.marketing.DesignEngine*'   (writes apps/android/build/design-fixtures)
//   2. node apps/android/scripts/check-design-engine.mjs                                          (this script; --keep-images to look)
//   3. the same gradle command again: it reads the answers back through DesignProtocol.parse, as the app does.
//
// What is proved: for each house, the page DesignProtocol.page builds loads (its CSP: no network, scripts and styles inline, data:
// pictures and fonts); each message DesignProtocol.message builds is answered through the very script DesignProtocol.call builds (the
// bridge `NativeDesign.input/done` is stood in for by a few lines here, which is all a WebView adds); and every answer has the fields
// the Kotlin reads: `doc`, `image` (a JPEG), `boxes`, `added`, `catalogue`, `names`, `problems`, `results`/`source` (resize), `layouts`.
// Needs Playwright's Chromium: PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers) and a `playwright` package, found in the repo's
// node_modules, then in $PLAYWRIGHT_ROOT, then in /opt/node-tools/node_modules.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const fixtures = path.resolve(here, '../build/design-fixtures');
const keepImages = process.argv.includes('--keep-images');

function loadPlaywright() {
  const roots = [root, process.env.PLAYWRIGHT_ROOT, '/opt/node-tools'].filter(Boolean);
  for (const r of roots) {
    try { return createRequire(path.join(r, 'package.json'))('playwright'); } catch { /* try the next */ }
  }
  throw new Error('No `playwright` package found: npm i -D playwright in the repo, or set PLAYWRIGHT_ROOT.');
}

function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const candidates = ['chromium-1194/chrome-linux/chrome', 'chromium_headless_shell-1194/chrome-linux/headless_shell', 'chromium/chrome-linux/chrome'];
  for (const c of candidates) if (fs.existsSync(path.join(base, c))) return path.join(base, c);
  return undefined; // let Playwright find its own
}

const failures = [];
const fail = (house, name, why) => { failures.push(`${house}/${name}: ${why}`); console.error(`  FAIL ${house}/${name}: ${why}`); };
const isJpeg = (b64) => typeof b64 === 'string' && b64.length > 100 && Buffer.from(b64.slice(0, 8), 'base64')[0] === 0xff && Buffer.from(b64.slice(0, 8), 'base64')[1] === 0xd8;

/** What DesignProtocol.parse does with a reply: a nativeError is a failure, a non-object is a failure. */
function parse(text) {
  const answer = JSON.parse(text);
  if (answer && answer.nativeError) throw new Error('nativeError: ' + answer.nativeError);
  if (!answer || typeof answer !== 'object' || Array.isArray(answer) || Object.keys(answer).length === 0) throw new Error('not an object');
  return answer;
}

const CATALOGUE_KEYS = ['templates', 'presets', 'squares', 'siteSquares', 'palettes', 'plays', 'stages', 'maisonHouses', 'scenes', 'formats', 'textStyles', 'badges', 'shapes', 'masks', 'filters', 'effects', 'fonts'];

async function checkHouse(browser, house) {
  const dir = path.join(fixtures, house);
  if (!fs.existsSync(path.join(dir, 'cases.json'))) throw new Error(`No fixtures in ${dir}: run the gradle step first.`);
  const html = fs.readFileSync(path.join(dir, 'page.html'), 'utf8');
  const { cases } = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
  const byName = Object.fromEntries(cases.map((c) => [c.name, c]));
  const answers = {};
  const outDir = path.join(dir, 'out');
  if (keepImages) fs.mkdirSync(outDir, { recursive: true });

  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => problems.push('request failed: ' + r.url().slice(0, 80)));
  // The page the app loads: loadDataWithBaseURL(null, page, "text/html"): no address, no network (the CSP says so too).
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__in = {}; window.__out = {};
    // The two calls DesignEngine's bridge answers (NativeDesign.input and NativeDesign.done).
    window.NativeDesign = { input: (id) => window.__in[id] ?? '{}', done: (id, out) => { window.__out[id] = out; } };
  });
  const hasEntry = await page.evaluate(() => typeof window.nativeDesign === 'function');
  if (!hasEntry) throw new Error(`${house}: window.nativeDesign is not a function: the bundle did not load`);

  /** Runs one message through the app's own call script; the answer text, as `NativeDesign.done` got it. */
  async function run(name, messageText, callScript) {
    const id = `case-${name}`;
    await page.evaluate(([i, text]) => { delete window.__out[i]; window.__in[i] = text; }, [id, messageText]);
    await page.evaluate(callScript);
    await page.waitForFunction((i) => window.__out[i] !== undefined, id, { timeout: 180_000 });
    return page.evaluate((i) => window.__out[i], id);
  }

  async function exec(name, mutate) {
    const c = byName[name];
    if (!c) { fail(house, name, 'no such case in the fixtures'); return null; }
    let text = c.message;
    if (mutate) { const m = JSON.parse(text); mutate(m); text = JSON.stringify(m); }
    const label = name + (mutate ? '*' : '');
    try {
      const raw = await run(name, text, c.call);
      const answer = parse(raw);
      answers[label] = raw;
      return answer;
    } catch (e) {
      fail(house, label, e.message);
      return null;
    }
  }

  function save(name, answer) {
    if (keepImages && answer?.image) fs.writeFileSync(path.join(outDir, `${name}.jpg`), Buffer.from(answer.image, 'base64'));
  }

  function expectPicture(name, a, { boxes = true } = {}) {
    if (!a) return;
    if (!isJpeg(a.image)) fail(house, name, '`image` is not a base64 JPEG');
    if (!a.doc || typeof a.doc !== 'object') fail(house, name, '`doc` is missing');
    if (boxes && !Array.isArray(a.boxes)) fail(house, name, '`boxes` is missing');
    for (const b of a.boxes ?? []) for (const k of ['id', 'x', 'y', 'w', 'h']) if (b[k] === undefined) fail(house, name, `a box has no ${k}`);
    if (!a.doc?.frame || !(a.doc.frame.w > 0) || !(a.doc.frame.h > 0)) fail(house, name, '`doc.frame` is missing');
    save(name.replace(/\*/g, ''), a);
  }

  console.log(`\n${house}: ${cases.length} cases`);

  // The first answer: the catalogue the menus read.
  const cat = await exec('catalogue');
  expectPicture('catalogue', cat);
  const catalogue = cat?.catalogue ?? {};
  for (const k of CATALOGUE_KEYS) if (!(k in catalogue)) fail(house, 'catalogue', `catalogue.${k} is missing`);
  for (const k of ['templates', 'presets', 'squares', 'palettes', 'scenes', 'textStyles', 'badges', 'shapes', 'masks', 'filters']) {
    if (!Array.isArray(catalogue[k]) || catalogue[k].length === 0) fail(house, 'catalogue', `catalogue.${k} is empty`);
  }
  for (const t of catalogue.templates ?? []) if (!t.id || !t.label) fail(house, 'catalogue', 'a template has no id or label');
  for (const s of catalogue.scenes ?? []) if (!s.id || !s.label) fail(house, 'catalogue', 'a scene has no id or label');
  for (const f of catalogue.filters ?? []) if (!f.label || typeof f.adjust !== 'object') fail(house, 'catalogue', 'a filter has no label or adjust');
  if (!(catalogue.maisonHouses ?? []).length) fail(house, 'catalogue', 'maisonHouses is empty');
  if (!Array.isArray(catalogue.formats) || !catalogue.formats.every((f) => f.id)) fail(house, 'catalogue', 'formats carry ids');

  // Laying out and drawing.
  const laid = await exec('layout-ad');
  expectPicture('layout-ad', laid);
  if (!laid?.doc?.meta && laid) { /* a template may leave `meta` to the caller, which sets meta.template */ }
  if (laid && !(laid.doc.layers?.length > 0)) fail(house, 'layout-ad', 'the ad layout has no layers');
  expectPicture('layout-ad-marked', await exec('layout-ad-marked'));
  const cat1 = await exec('layout-catalogue');
  expectPicture('layout-catalogue', cat1);
  expectPicture('layout-preset', await exec('layout-preset'));
  expectPicture('layout-square', await exec('layout-square'));
  expectPicture('palette', await exec('palette'));
  expectPicture('preview', await exec('preview'));
  expectPicture('thumb', await exec('thumb'));
  expectPicture('render', await exec('render'));
  expectPicture('render-painted', await exec('render-painted'));
  const v2 = await exec('render-v2');
  expectPicture('render-v2', v2);
  if (v2) {
    // Every v2 field survives a draw (the document comes back as it went in: nothing is dropped).
    const layer = (id) => v2.doc.layers.find((l) => l.id === id);
    if (!layer('t1')?.runs?.length) fail(house, 'render-v2', 'rich text runs were dropped');
    if (!layer('s1')?.fillGradient) fail(house, 'render-v2', 'a gradient fill was dropped');
    if (!layer('s1')?.layerFx?.glow) fail(house, 'render-v2', 'layer effects were dropped');
    if (!layer('q1')?.value) fail(house, 'render-v2', 'a QR layer was dropped');
    if (!v2.doc.bg?.fill) fail(house, 'render-v2', 'the multi-colour base was dropped');
    if (!v2.doc.meta?.guides) fail(house, 'render-v2', 'guides were dropped');
    // A QR code is a box on the page the editor can select.
    if (!(v2.boxes ?? []).some((b) => b.id === 'q1')) fail(house, 'render-v2', 'the QR layer has no box');
  }

  // Every layout the menus offer, from the catalogue: the ads' templates, the story presets, the squares and Edit a piece's.
  for (const t of catalogue.templates ?? []) {
    const a = await exec('layout-ad', (m) => { m.value = t.id; });
    if (a) { expectPicture(`layout-ad:${t.id}`, a); }
  }
  for (const p of catalogue.presets ?? []) {
    const a = await exec('layout-preset', (m) => { m.value = p.id; });
    if (a) expectPicture(`layout-preset:${p.id}`, a);
  }
  for (const s of [...(catalogue.squares ?? []), ...(catalogue.siteSquares ?? [])]) {
    const a = await exec('layout-square', (m) => { m.value = s.id; });
    if (a) expectPicture(`layout-square:${s.id}`, a);
  }
  for (const p of catalogue.palettes ?? []) {
    const a = await exec('palette', (m) => { m.palette = p.id; });
    if (a) expectPicture(`palette:${p.id}`, a);
  }

  // The designer's own moves: what they add comes back as `added`, the ids to select.
  const first = (list) => list?.[0]?.id ?? list?.[0];
  for (const [name, list] of [['add-textStyle', catalogue.textStyles], ['add-badge', catalogue.badges], ['add-shape-more', catalogue.shapes], ['add-inset-mask', catalogue.masks]]) {
    const a = await exec(name, (m) => { m.value = first(list); });
    expectPicture(name, a);
    if (a && !(a.added?.length > 0)) fail(house, name, '`added` names nothing');
  }
  for (const name of ['add-text', 'add-shape', 'add-line', 'add-mark', 'add-inset', 'add-link']) {
    const a = await exec(name);
    expectPicture(name, a);
    if (a && !(a.added?.length > 0)) fail(house, name, '`added` names nothing');
  }
  for (const name of ['scale', 'align', 'align-page', 'distribute', 'carry']) expectPicture(name, await exec(name));

  // Resize: the master (the laid-out page) on three shapes, then with a swapped photograph, then the merge of its answers.
  const master = laid?.doc;
  const resize = await exec('resize', (m) => { m.doc = master; });
  if (resize) {
    if (!resize.source?.frame || !Array.isArray(resize.source?.layers)) fail(house, 'resize', '`source` has no frame or layers');
    if (!Array.isArray(resize.results) || resize.results.length !== 3) fail(house, 'resize', 'one result per target');
    (resize.results ?? []).forEach((r, i) => {
      for (const k of ['doc', 'frame', 'score', 'notes', 'penalties', 'strategy', 'needsExtend', 'ai']) if (r[k] === undefined) fail(house, 'resize', `result ${i} has no ${k}`);
      if (typeof r.score !== 'number') fail(house, 'resize', `result ${i}'s score is not a number`);
      if (!Array.isArray(r.ai?.layers) || r.ai?.plan === undefined) fail(house, 'resize', `result ${i} has no ai.layers or ai.plan`);
    });
    if (resize.results?.[0]?.frame?.h !== 1080) fail(house, 'resize', 'the first result is not square');
    if (keepImages) (resize.results ?? []).forEach((r, i) => r.ai?.thumb && fs.writeFileSync(path.join(outDir, `resize-${i}.jpg`), Buffer.from(r.ai.thumb, 'base64')));
    // resizeAll's second call: the route's plan is null here (no AI), as when it gave nothing; items are { det (ai cleared), plan }.
    const items = resize.results.map((r) => ({ det: { ...r, ai: null }, plan: null }));
    const merged = await exec('resize-merge', (m) => { m.doc = master; m.items = items; });
    if (merged && (!Array.isArray(merged.results) || merged.results.length !== items.length)) fail(house, 'resize-merge', 'one result per item');
    for (const r of merged?.results ?? []) for (const k of ['doc', 'frame', 'score', 'strategy']) if (r[k] === undefined) fail(house, 'resize-merge', `a result has no ${k}`);
  }
  const swapped = await exec('resize-swap', (m) => { m.doc = master; });
  if (swapped && !(swapped.results?.length === 1)) fail(house, 'resize-swap', 'one result');
  if (swapped && JSON.stringify(swapped.results?.[0]?.doc ?? {}).includes('"inset"') === false) fail(house, 'resize-swap', 'the swapped photograph is not in the result');

  // Publish: the website's file names (a Maisons piece's own), the house rules on the words.
  const names = await exec('names');
  if (names && !(names.names?.length === 3 && names.names.every((n) => typeof n === 'string' && n.length > 0))) fail(house, 'names', 'three file names');
  const maison = await exec('names-maison');
  if (maison && !(maison.names?.length === 2 && /Cartier/i.test(maison.names[0]))) fail(house, 'names-maison', `a Maisons name starts with its house (${JSON.stringify(maison.names)})`);
  const words = await exec('words');
  if (words && !(Array.isArray(words.problems) && words.problems.length > 0)) fail(house, 'words', 'sale words and a hashtag are not found');
  const sites = await exec('siteLayouts');
  if (sites && !(Array.isArray(sites.layouts) && sites.layouts.length > 0)) fail(house, 'siteLayouts', 'no layouts');
  if (sites && sites.start === undefined) fail(house, 'siteLayouts', 'no start layout');

  if (problems.length) {
    for (const p of [...new Set(problems)]) fail(house, 'page', p);
  }
  fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(answers));
  await page.close();
  console.log(`${house}: ${Object.keys(answers).length} answers kept in ${path.join(dir, 'answers.json')}`);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  for (const house of ['taheri', 'mina']) await checkHouse(browser, house);
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} problem(s).`);
  process.exit(1);
}
console.log('\nThe bundles answer every message the Android app sends.');
