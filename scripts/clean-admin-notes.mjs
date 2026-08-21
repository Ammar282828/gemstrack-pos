// Split staff-only content out of item "Admin-Only Note" fields.
//
// The karigar portal now shows item.adminNote (it holds the making
// instructions). A few notes also carried things a contractor should not see —
// a customer's home address, a discount, a billing instruction. Those lines are
// moved to the ORDER-level notes field, which karigars never receive; the
// making instructions stay on the item.
//
//   node scripts/clean-admin-notes.mjs            # dry run
//   node scripts/clean-admin-notes.mjs --apply

import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = 'hom-pos-52710474-ceeea';

// Explicit, reviewable list — no regex guessing at someone's business data.
// key: `${orderId}:${itemIndex}` → exact lines to lift out of the item note.
const MOVE = {
  'ORD-000002:0': ['Reconstructed 2026-08-22: original items were lost when the order was overwritten and restored from the activity log. Price set from the stored subtotal.'],
  'ORD-000080:0': ['Rs 10'],
  'ORD-000083:0': ['Discount 2000'],
  'ORD-000089:0': ['Give weight in bill'],
  'ORD-000091:0': ['Flat 204, Ezzy homes, Karim Bhai housing society, scheme 33, second floor'],
};

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
const B = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const toFs = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') { const f = {}; for (const [k, vv] of Object.entries(v)) f[k] = toFs(vv); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
};
const walk = v => {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(walk);
  if (v.mapValue !== undefined) { const o = {}; for (const [k, vv] of Object.entries(v.mapValue.fields || {})) o[k] = walk(vv); return o; }
  return undefined;
};
const ext = d => { const o = {}; for (const [k, v] of Object.entries(d.fields || {})) o[k] = walk(v); o._id = d.name.split('/').pop(); return o; };

async function getOrder(id) {
  const r = await fetch(`${B}/orders/${id}`, { headers: H });
  if (!r.ok) return null;
  return ext(await r.json());
}
async function patchOrder(id, items, notes) {
  const p = new URLSearchParams();
  p.append('updateMask.fieldPaths', 'items');
  p.append('updateMask.fieldPaths', 'notes');
  const r = await fetch(`${B}/orders/${id}?${p}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { items: toFs(items), notes: { stringValue: notes } } }),
  });
  if (!r.ok) throw new Error(`patch ${id}: ${r.status} ${(await r.text()).slice(0, 250)}`);
}

console.log(`\nMode: ${APPLY ? 'APPLY' : 'DRY RUN'}  →  MINA (${PROJECT_ID})\n`);

const byOrder = {};
for (const key of Object.keys(MOVE)) {
  const [orderId, idx] = key.split(':');
  (byOrder[orderId] ||= []).push({ idx: Number(idx), lines: MOVE[key] });
}

const backup = [];
for (const [orderId, moves] of Object.entries(byOrder)) {
  const order = await getOrder(orderId);
  if (!order) { console.log(`⚠️  ${orderId}: not found`); continue; }
  const items = Array.isArray(order.items) ? [...order.items] : [];
  backup.push({ orderId, items: JSON.parse(JSON.stringify(items)), notes: order.notes ?? '' });

  const moved = [];
  for (const { idx, lines } of moves) {
    const item = items[idx];
    if (!item) { console.log(`⚠️  ${orderId}[${idx}]: item missing`); continue; }
    const before = String(item.adminNote || '');
    const kept = before.split('\n')
      .filter(l => !lines.some(m => l.trim() === m.trim()))
      .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const actuallyMoved = lines.filter(m => before.split('\n').some(l => l.trim() === m.trim()));
    if (!actuallyMoved.length) { console.log(`⚠️  ${orderId}[${idx}]: expected line(s) not found — skipping`); continue; }

    console.log(`${orderId} [item ${idx}]`);
    console.log(`   note before : ${JSON.stringify(before)}`);
    console.log(`   note after  : ${JSON.stringify(kept)}`);
    console.log(`   moved out   : ${actuallyMoved.map(m => JSON.stringify(m)).join(', ')}`);

    const next = { ...item };
    if (kept) next.adminNote = kept; else delete next.adminNote;
    items[idx] = next;
    moved.push(...actuallyMoved);
  }

  if (!moved.length) continue;
  const existing = String(order.notes || '').trim();
  const addition = `[Staff only — moved from item note]\n${moved.join('\n')}`;
  const newNotes = existing ? `${existing}\n\n${addition}` : addition;
  console.log(`   order.notes → ${JSON.stringify(newNotes.slice(0, 160))}${newNotes.length > 160 ? '…' : ''}\n`);

  if (APPLY) {
    await patchOrder(orderId, items, newNotes);
    console.log(`   ✅ written\n`);
  }
}

if (!APPLY) { console.log('DRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }
const out = `scripts/clean-admin-notes.${Date.now()}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), backup }, null, 2));
console.log(`Done. Backup of prior items+notes: ${out}`);
