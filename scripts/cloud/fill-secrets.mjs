// Fill the secret lines of .env.taheri.local and .env.mina.local from Secret Manager.
//
//   node scripts/cloud/fill-secrets.mjs
//
// scripts/env-for-house.mjs writes each house's file from the YAML with every `secret:` left
// empty; this reads each of those secrets from the house's own project (the file's
// NEXT_PUBLIC_FIREBASE_PROJECT_ID) with the machine's Google credentials — in a cloud session
// the claude-cloud@gemstrack-pos service account, which may read exactly the secrets the two
// backends declare (CLAUDE.md, "Cloud sessions"). Prints names and counts, never a value.

import fs from 'node:fs';
import yaml from 'yaml';
import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const token = (await (await auth.getClient()).getAccessToken()).token;

const load = (f) => (yaml.parse(fs.readFileSync(f, 'utf8')).env || []);

async function readSecret(project, name) {
  const res = await fetch(`https://secretmanager.googleapis.com/v1/projects/${project}/secrets/${name}/versions/latest:access`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(String(res.status));
  return Buffer.from((await res.json()).payload.data, 'base64').toString('utf8').trim();
}

// Unquoted where dotenv reads it back unchanged; otherwise single quotes (no $ expansion),
// or a JSON string for the rare value that holds a single quote or a line break.
const envValue = (v) => (/^[\w@%+=:,./-]*$/.test(v) ? v : /['\n]/.test(v) ? JSON.stringify(v) : `'${v}'`);

let failed = 0;
for (const house of ['taheri', 'mina']) {
  const file = `.env.${house}.local`;
  if (!fs.existsSync(file)) { console.log(`${file}: missing (run node scripts/env-for-house.mjs ${house})`); failed++; continue; }
  const merged = new Map();
  for (const e of [...load('apphosting.yaml'), ...load(`apphosting.${house}.yaml`)]) merged.set(e.variable, e);
  const project = String(merged.get('NEXT_PUBLIC_FIREBASE_PROJECT_ID')?.value ?? '');
  const secrets = [...merged.values()].filter((e) => e.secret !== undefined);
  const values = new Map();
  const missing = [];
  await Promise.all(secrets.map(async (e) => {
    try { values.set(e.variable, await readSecret(project, e.secret)); }
    catch (err) { missing.push(`${e.secret} (${err.message})`); }
  }));
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => {
    const k = l.match(/^([A-Z_0-9]+)=/)?.[1];
    return k && values.has(k) ? `${k}=${envValue(values.get(k))}` : l;
  });
  fs.writeFileSync(file, lines.join('\n'));
  fs.chmodSync(file, 0o600);
  console.log(`${file} (${project}): ${values.size}/${secrets.length} secrets filled${missing.length ? ` — not read: ${missing.join(', ')}` : ''}`);
  failed += missing.length;
}
process.exit(failed ? 1 : 0);
