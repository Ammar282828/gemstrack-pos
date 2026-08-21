// Import Taheri's karigar gold khata (from a transcription .md) into `hisaab`.
//   Given (gold to karigar)      -> goldDebitGrams
//   Received (pieces from karigar)-> goldCreditGrams
//   entityType: 'karigar'
//
//   node scripts/import-karigar-khata.mjs <file.md>            # dry run / sample
//   node scripts/import-karigar-khata.mjs <file.md> --apply    # create karigars + write hisaab
//   node scripts/import-karigar-khata.mjs <file.md> --only RAHEEL   # focus one karigar

import { readFileSync } from 'fs';
import { homedir } from 'os';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FILE = args.find(a => a.endsWith('.md')) || `${homedir()}/Downloads/karigar-khata-transcription.md`;
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? (args[onlyIdx + 1] || '').toUpperCase() : null;

// ── resilient fetch ──
const _fetch = globalThis.fetch;
async function fetch(url, opts) {
  let last;
  for (let i = 1; i <= 6; i++) {
    try { return await _fetch(url, opts); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 700 * i)); }
  }
  throw last;
}

// ── Firestore ──
// TAHERI store = project 'gemstrack-pos'.  Mina store = 'hom-pos-52710474-ceeea'.
// This karigar khata belongs to TAHERI, so default there. Override with --project.
const projIdx = args.indexOf('--project');
const PROJECT_ID = projIdx >= 0 ? args[projIdx + 1] : 'gemstrack-pos';
console.log(`\n🎯 TARGET FIRESTORE PROJECT: ${PROJECT_ID}${PROJECT_ID === 'gemstrack-pos' ? '  (Taheri POS)' : PROJECT_ID.startsWith('hom-pos') ? '  (⚠️ MINA POS)' : ''}`);
const fb = JSON.parse(readFileSync(homedir() + '/.config/configstore/firebase-tools.json', 'utf8'));
const tok = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: fb.tokens.refresh_token,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
  }),
}).then(r => r.json());
const H = { Authorization: `Bearer ${tok.access_token}` };
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (typeof v === 'object') { const f = {}; for (const [k, vv] of Object.entries(v)) f[k] = toFs(vv); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function ext(doc) {
  const walk = (v) => {
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.integerValue !== undefined) return Number(v.integerValue);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.nullValue !== undefined) return null;
    if (v.mapValue !== undefined) { const o = {}; for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = walk(vv); return o; }
    return undefined;
  };
  const o = {}; for (const [k, v] of Object.entries(doc.fields || {})) o[k] = walk(v);
  o._id = doc.name.split('/').pop(); return o;
}
async function listAll(coll) {
  const all = []; let pt = '';
  do {
    const d = await fetch(`${BASE}/${coll}?pageSize=300${pt ? '&pageToken=' + pt : ''}`, { headers: H }).then(r => r.json());
    if (d.documents) all.push(...d.documents.map(ext));
    pt = d.nextPageToken || '';
  } while (pt);
  return all;
}
async function createDoc(coll, id, obj) {
  const q = id ? `?documentId=${encodeURIComponent(id)}` : '';
  const r = await fetch(`${BASE}/${coll}${q}`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toFs(v)])) }),
  });
  if (!r.ok) throw new Error(`create ${coll}/${id}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return ext(await r.json());
}

// ── parse the markdown ──
const md = readFileSync(FILE, 'utf8');
const lines = md.split('\n');

function baseName(header) {
  let n = header.replace(/^##\s+/, '').trim();
  n = n.split('—')[0].split('(')[0].trim();       // drop "— Page 2", "(CNC)"
  return n.toUpperCase();
}
function parseWeight(cell) {
  let s = cell.replace(/\*\*/g, '').replace(/~~/g, '').replace(/\[.*?\]/g, '').replace(/g\b/gi, '').trim();
  if (/total|struck|^\s*$/i.test(cell)) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function parseDate(cell) {
  const m = (cell || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `20${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00.000Z`;
}

const karigars = new Map(); // name -> { given:[], received:[] }
const warnings = [];
let curName = null, mode = null, skipUnnamed = false;

for (const raw of lines) {
  const line = raw.trimEnd();
  if (line.startsWith('## ')) {
    const nm = baseName(line);
    // Only skip pages that are genuinely unnamed (header STARTS with "UNNAMED"),
    // not continuation pages like "HAMEEDULLAH — Page 2 (continuation, unnamed page)".
    skipUnnamed = /^##\s+UNNAMED/i.test(line);
    if (skipUnnamed) { warnings.push(`Skipped section (unnamed/ambiguous): ${line.replace(/^##\s+/, '')}`); curName = null; continue; }
    curName = nm;
    if (!karigars.has(curName)) karigars.set(curName, { given: [], received: [], hasAmounts: /NOMAN/i.test(nm) });
    mode = null;
    continue;
  }
  if (skipUnnamed || !curName) continue;
  if (/^###\s+Given/i.test(line)) { mode = 'given'; continue; }
  if (/^###\s+Received/i.test(line)) { mode = 'received'; continue; }
  if (!line.startsWith('|') || !mode) continue;

  const cells = line.split('|').slice(1, -1).map(c => c.trim());
  if (!cells.length) continue;
  if (/weight/i.test(cells[0]) || /^-+$/.test(cells[0])) continue; // header/separator
  if (/total/i.test(cells[0])) continue;
  if (/struck through/i.test(line) || cells.every(c => c === '')) continue;

  const w = parseWeight(cells[0]);
  if (w === null || isNaN(w)) { if (cells[0]) warnings.push(`${curName}: unparsed weight "${cells[0]}"`); continue; }

  const g = karigars.get(curName);
  if (mode === 'given') {
    // given cols: Weight | Item | Date   (NOMAN: Weight|Item|StoneWt|Amount, date sometimes in item)
    const item = cells[1] || '';
    const explicitDate = g.hasAmounts ? parseDate(item) : parseDate(cells[2] || '') || parseDate(item);
    const amount = g.hasAmounts ? (parseFloat((cells[3] || '').replace(/[^\d.]/g, '')) || 0) : 0;
    // Carry forward the last seen date within this karigar's given column if missing.
    const date = explicitDate || g._lastGivenDate || null;
    if (explicitDate) g._lastGivenDate = explicitDate;
    g.given.push({ grams: w, item: item.replace(/\(\d{1,2}\/\d{1,2}\/\d{2}\)/, '').trim(), date, amount, inferredDate: !explicitDate });
    if (!date) warnings.push(`${curName} given ${w}g "${item}": no date (and none to carry forward)`);
    else if (!explicitDate) warnings.push(`${curName} given ${w}g "${item}": date inferred from previous row (${date.slice(0,10)})`);
  } else {
    const explicitDate = parseDate(cells[1] || cells[0]);
    const date = explicitDate || g._lastRecvDate || null;
    if (explicitDate) g._lastRecvDate = explicitDate;
    g.received.push({ grams: w, date, inferredDate: !explicitDate });
    if (!date) warnings.push(`${curName} received ${w}g: no date (and none to carry forward)`);
    else if (!explicitDate) warnings.push(`${curName} received ${w}g: date inferred (${date.slice(0,10)})`);
  }
}

// ── match to existing karigars ──
const existing = await listAll('karigars');
const byName = new Map(existing.map(k => [String(k.name || '').trim().toUpperCase(), k]));

const fmt = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
let names = [...karigars.keys()];
if (ONLY) names = names.filter(n => n.includes(ONLY));

const IMPORT_BATCH = 'taheri-karigar-khata-2026-07';

// Back-fill any still-missing dates with the karigar's earliest known date so
// nothing is silently dropped (e.g. Noman's first undated bangle rows).
for (const g of karigars.values()) {
  const dates = [...g.given, ...g.received].map(x => x.date).filter(Boolean).sort();
  const first = dates[0] || null;
  for (const x of [...g.given, ...g.received]) if (!x.date && first) { x.date = first; x.backfilled = true; }
}

// ── build planned hisaab entries ──
function buildEntries(name, karigarId, properName) {
  const g = karigars.get(name);
  const out = [];
  for (const x of g.given) {
    const making = x.amount ? ` [making ${x.amount}]` : '';
    out.push({
      entityId: karigarId, entityType: 'karigar', entityName: properName || name,
      date: x.date || '', description: `Given: ${x.item || 'gold'}${making}`,
      cashDebit: 0, cashCredit: 0, goldDebitGrams: x.grams, goldCreditGrams: 0,
      source: 'khata-import', importBatch: IMPORT_BATCH,
    });
  }
  for (const x of g.received) out.push({
    entityId: karigarId, entityType: 'karigar', entityName: properName || name,
    date: x.date || '', description: `Received (piece)`,
    cashDebit: 0, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: x.grams,
    source: 'khata-import', importBatch: IMPORT_BATCH,
  });
  return out;
}
function properCase(n) { return n.replace(/\b\w/g, c => c.toUpperCase()); }

console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN (sample)'}   file: ${FILE}\n`);
console.log('KARIGAR SUMMARY');
console.log('─'.repeat(96));
console.log('  Karigar'.padEnd(24) + 'exists'.padEnd(9) + 'given#'.padStart(7) + 'given g'.padStart(12) + 'recv#'.padStart(7) + 'recv g'.padStart(12) + 'net g (out)'.padStart(14));
let totGiven = 0, totRecv = 0, totEntries = 0;
for (const name of names) {
  const g = karigars.get(name);
  const gv = g.given.reduce((s, x) => s + x.grams, 0);
  const rv = g.received.reduce((s, x) => s + x.grams, 0);
  totGiven += gv; totRecv += rv; totEntries += g.given.length + g.received.length;
  const k = byName.get(name);
  console.log('  ' + name.padEnd(22) + (k ? 'yes' : 'NEW').padEnd(9) +
    String(g.given.length).padStart(7) + fmt(gv).padStart(12) +
    String(g.received.length).padStart(7) + fmt(rv).padStart(12) + fmt(gv - rv).padStart(14) +
    (g.hasAmounts ? '  (has cash amounts)' : ''));
}
console.log('─'.repeat(96));
console.log('  TOTAL'.padEnd(24) + ''.padEnd(9) + ''.padStart(7) + fmt(totGiven).padStart(12) + ''.padStart(7) + fmt(totRecv).padStart(12) + fmt(totGiven - totRecv).padStart(14));
console.log(`\n  ${totEntries} hisaab entries would be written across ${names.length} karigars.`);
console.log(`  Karigars to CREATE: ${names.filter(n => !byName.get(n)).join(', ') || 'none'}`);

// ── detailed sample: first matching karigar (or RAHEEL) ──
const sampleName = ONLY ? names[0] : (names.includes('RAHEEL') ? 'RAHEEL' : names[0]);
if (sampleName) {
  const k = byName.get(sampleName);
  const entries = buildEntries(sampleName, k ? k._id : `<new-karigar-id>`);
  console.log(`\nSAMPLE — hisaab entries for ${sampleName} (${entries.length}):`);
  console.log('─'.repeat(96));
  entries.forEach(e => console.log(
    `  ${(e.date ? e.date.slice(0, 10) : 'NO DATE').padEnd(12)} ${e.description.padEnd(34)} ` +
    `${e.goldDebitGrams ? 'GIVEN  ' + fmt(e.goldDebitGrams) + 'g' : 'RECV   ' + fmt(e.goldCreditGrams) + 'g'}`));
}

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} PARSE WARNINGS (need a decision):`);
  warnings.slice(0, 40).forEach(w => console.log('   • ' + w));
  if (warnings.length > 40) console.log(`   … and ${warnings.length - 40} more`);
}

if (!APPLY) { console.log('\nDRY RUN — nothing written. Review the sample, then re-run with --apply.'); process.exit(0); }

// ── APPLY ──
console.log(`\n=== APPLYING to ${PROJECT_ID} ===`);
let written = 0, created = 0;
for (const name of names) {
  let k = byName.get(name);
  if (!k) {
    const id = `karigar-khata-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    k = await createDoc('karigars', id, {
      name: properCase(name), notes: 'Imported from Taheri gold khata', importBatch: IMPORT_BATCH,
    });
    created++;
    console.log(`  + created karigar ${name} (${k._id})`);
  }
  const entries = buildEntries(name, k._id, properCase(name)).filter(e => e.date);
  for (const e of entries) await createDoc('hisaab', null, e);
  written += entries.length;
  console.log(`  ${name}: wrote ${entries.length} hisaab entries`);
}
console.log(`\nDone. Created ${created} karigars, wrote ${written} hisaab entries.`);
console.log(`All tagged importBatch="${IMPORT_BATCH}" — reversible with a single query.`);
