// The ERP's map for the native iPhone app, one file per house (src/lib/nav-export.ts):
//
//   npm run nav:export   →  apps/iphone/App/Resources/nav-taheri.json, nav-mina.json
//
// Each house is evaluated in a process of its own with that house's environment
// (apphosting.yaml + apphosting.<house>.yaml), as its backend sees it.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import yaml from 'yaml';

const houses = ['taheri', 'mina'];
const load = (f) => (yaml.parse(fs.readFileSync(f, 'utf8')).env || []);

export function houseEnv(house) {
  const env = {};
  for (const h of houses) for (const e of load(`apphosting.${h}.yaml`)) env[e.variable] = '';
  for (const e of [...load('apphosting.yaml'), ...load(`apphosting.${house}.yaml`)]) if (e.value !== undefined) env[e.variable] = String(e.value);
  return env;
}

const one = process.argv[2];
if (one) {
  // The child: this house's environment is already set; print its map.
  const { exportNav } = await import('../src/lib/nav-export.ts');
  const nav = await import('../src/lib/nav.ts');
  process.stdout.write(JSON.stringify(exportNav(nav), null, 2) + '\n');
} else {
  for (const house of houses) {
    const out = execFileSync('npx', ['tsx', 'scripts/nav-export.mjs', house], {
      env: { ...process.env, ...houseEnv(house), NODE_ENV: 'production' }, encoding: 'utf8',
    });
    fs.writeFileSync(`apps/iphone/App/Resources/nav-${house}.json`, out);
    console.log(`nav-${house}.json: ${JSON.parse(out).entries.length} entries`);
  }
}
