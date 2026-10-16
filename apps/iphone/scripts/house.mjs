// Dress the native iPhone app as one house before generating the project:
//
//   node scripts/house.mjs <taheri|mina> [--sign <team> <app profile> <widget profile>]
//   node scripts/house.mjs <taheri|mina> --auto [team] [build number]
//
// --sign is GitHub's TestFlight job (a certificate and profiles made for the one build); --auto is Xcode
// Cloud's and a Mac's (automatic signing: Xcode Cloud signs in the cloud for the team it is given,
// ci_scripts/ci_post_clone.sh), with the build number Xcode Cloud counts.
//
// The default build is the MERGED app: shop.taheri.erp, home-screen name "ERP", holding every business (Taheri, House of
// Mina, any added by address; Config/Businesses.swift). "taheri" is only its bundle and asset base, and ERP_HOUSE no longer
// drives behaviour at run time: it picks the launch screen, the primary app icon and the global accent colour. House of Mina's
// own app (`mina`, store.houseofmina.erp) is DEPRECATED: it keeps building for Xcode Cloud so its testers can move over, and
// is removed once they have.
//
// Writes House.xcconfig (read by every target, project.yml configFiles) from houses.json, and
// prints the same values KEY=VALUE for $GITHUB_ENV. Then `xcodegen` makes ERP.xcodeproj.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: a checkout under "Mac SSD" kept its %20 and houses.json was not found.
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const houses = JSON.parse(fs.readFileSync(path.join(dir, 'houses.json'), 'utf8'));
const name = process.argv[2];
const h = houses[name];
if (!h) { console.error(`usage: node scripts/house.mjs <${Object.keys(houses).join('|')}> [--sign team appProfile widgetProfile]`); process.exit(1); }
if (h.deprecated) console.error(`note: the ${name} app is deprecated. ${h.deprecated}`);
const sign = process.argv[3] === '--sign' ? { team: process.argv[4], app: process.argv[5], widget: process.argv[6] } : null;
const auto = process.argv[3] === '--auto' ? { team: process.argv[4] || '', build: process.argv[5] || '' } : null;

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
  // Alternate app icons (space-separated asset names; the Settings toggle sets them). The merged app offers Mina's.
  ERP_ALT_ICONS: (h.alternateIcons || []).join(' '),
  ERP_LAUNCH_COLOR: `Launch-${name}`,
  ERP_LAUNCH_MARK: `LaunchLogo-${name}`,
};
// xcconfig reads "//" as a comment, so a URL's slashes are escaped with $() between them.
const esc = (v) => String(v).replace(/\/\//g, '/$()/');
let text = `// ${name}: written by scripts/house.mjs from houses.json — edit that, not this.\n`;
for (const [k, v] of Object.entries(s)) text += `${k} = ${esc(v)}\n`;
if (sign) {
  text += `CODE_SIGN_STYLE = Manual\nDEVELOPMENT_TEAM = ${sign.team}\nCODE_SIGN_IDENTITY = Apple Distribution\n`;
  text += `ERP_APP_PROFILE = ${sign.app}\nERP_WIDGET_PROFILE = ${sign.widget}\n`;
}
if (auto) {
  text += `CODE_SIGN_STYLE = Automatic\n`;
  if (auto.team) text += `DEVELOPMENT_TEAM = ${auto.team}\n`;
}
// The build number: Xcode Cloud's count, else 1 (GitHub's job sets its own on the command line).
text += `CURRENT_PROJECT_VERSION = ${auto?.build || '1'}\n`;
fs.writeFileSync(path.join(dir, 'House.xcconfig'), text);
for (const [k, v] of Object.entries(s)) console.log(`${k}=${v}`);
