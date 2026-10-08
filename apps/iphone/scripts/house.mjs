// Dress the native iPhone app as one house before generating the project:
//
//   node scripts/house.mjs <taheri|mina> [--sign <team> <app profile> <widget profile>]
//
// Writes House.xcconfig (read by every target, project.yml configFiles) from houses.json, and
// prints the same values KEY=VALUE for $GITHUB_ENV. Then `xcodegen` makes ERP.xcodeproj.

import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const houses = JSON.parse(fs.readFileSync(path.join(dir, 'houses.json'), 'utf8'));
const name = process.argv[2];
const h = houses[name];
if (!h) { console.error(`usage: node scripts/house.mjs <${Object.keys(houses).join('|')}> [--sign team appProfile widgetProfile]`); process.exit(1); }
const sign = process.argv[3] === '--sign' ? { team: process.argv[4], app: process.argv[5], widget: process.argv[6] } : null;

const s = {
  ERP_HOUSE: name,
  ERP_BUNDLE_ID: h.bundleId,
  ERP_DISPLAY_NAME: h.homeName,
  ERP_STORE_NAME: h.storeName,
  ERP_SERVER_URL: h.url,
  ERP_METAL: h.metal,
  ERP_ACCENT: h.accent,
  ERP_GROUND: h.ground,
  ERP_GOOGLE_CLIENT_ID: h.googleClientId,
  ERP_FIREBASE_PROJECT_ID: h.firebase.projectId,
  ERP_FIREBASE_API_KEY: h.firebase.apiKey,
  ERP_FIREBASE_SENDER_ID: h.firebase.senderId,
  ERP_FIREBASE_STORAGE_BUCKET: h.firebase.storageBucket,
  ERP_FIREBASE_APP_ID: h.firebase.iosAppId || '',
  ERP_APPICON: `AppIcon-${name}`,
  ERP_LAUNCH_COLOR: `Launch-${name}`,
  ERP_LAUNCH_MARK: `LaunchMark-${name}`,
};
// xcconfig reads "//" as a comment, so a URL's slashes are escaped with $() between them.
const esc = (v) => String(v).replace(/\/\//g, '/$()/');
let text = `// ${name}: written by scripts/house.mjs from houses.json — edit that, not this.\n`;
for (const [k, v] of Object.entries(s)) text += `${k} = ${esc(v)}\n`;
if (sign) {
  text += `CODE_SIGN_STYLE = Manual\nDEVELOPMENT_TEAM = ${sign.team}\nCODE_SIGN_IDENTITY = Apple Distribution\n`;
  text += `ERP_APP_PROFILE = ${sign.app}\nERP_WIDGET_PROFILE = ${sign.widget}\n`;
}
fs.writeFileSync(path.join(dir, 'House.xcconfig'), text);
for (const [k, v] of Object.entries(s)) console.log(`${k}=${v}`);
