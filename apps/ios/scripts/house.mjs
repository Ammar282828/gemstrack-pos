// Dress the iPhone app as one house before a build:
//
//   node scripts/house.mjs <taheri|mina> [--sign <team> <profile name>]
//
// Writes capacitor.config.json (which `cap sync ios` copies into the app) and www/offline.html
// from houses.json, and sets the house's Xcode settings on the App target (bundle ID, name, icon,
// launch screen, Google client) — on the target alone, not on the command line, where they would
// reach Capacitor's packages too. With --sign, the target is also signed by hand with the build's
// own profile (scripts/asc.mjs sign). Prints the settings, KEY=VALUE a line, for $GITHUB_ENV.
// Taheri's are the project's committed defaults: the project opened in Xcode as it is builds Taheri.

import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const houses = JSON.parse(fs.readFileSync(path.join(dir, 'houses.json'), 'utf8'));
const name = process.argv[2];
const h = houses[name];
if (!h) {
  console.error(`usage: node scripts/house.mjs <${Object.keys(houses).join('|')}>`);
  process.exit(1);
}

const config = {
  appId: h.bundleId,
  appName: h.homeName,
  webDir: 'www',
  // The app is the live ERP: every change to the ERP reaches the phones with the next page load,
  // and only a change to the native shell needs a new build.
  server: {
    url: h.url,
    // Other addresses of the same ERP stay inside the app; any other site opens in Safari or its own app.
    allowNavigation: h.hosts,
    // No connection when the app opens: the page in www/ says so and tries again.
    errorPath: 'offline.html',
  },
  // No backgroundColor: behind the page is the phone's own light or dark (systemBackground), as
  // the ERP itself follows the phone's choice; the house's ground is the launch screen's.
  ios: {
    contentInset: 'automatic',
    // Server logs and the sign-in log tell the app from Safari by this ("ERPApp/1 (taheri)").
    appendUserAgent: `ERPApp/1 (${name})`,
    scrollEnabled: true,
  },
};
fs.writeFileSync(path.join(dir, 'capacitor.config.json'), JSON.stringify(config, null, 2) + '\n');
const offline = fs.readFileSync(path.join(dir, 'www', 'offline.template.html'), 'utf8')
  .replaceAll('{{NAME}}', h.homeName).replaceAll('{{URL}}', h.url).replaceAll('{{GROUND}}', h.ground);
fs.writeFileSync(path.join(dir, 'www', 'offline.html'), offline);

const sign = process.argv[3] === '--sign' ? { team: process.argv[4], profile: process.argv[5] } : null;
if (process.argv[3] === '--sign' && !(sign.team && sign.profile)) {
  console.error('usage: node scripts/house.mjs <house> --sign <team> <profile name>');
  process.exit(1);
}

const settings = {
  ERP_HOUSE: name,
  ERP_BUNDLE_ID: h.bundleId,
  ERP_DISPLAY_NAME: h.homeName,
  ERP_STORE_NAME: h.storeName,
  ERP_GOOGLE_CLIENT_ID: h.googleClientId || '',
  ERP_APPICON: `AppIcon-${name}`,
  ERP_LAUNCH_COLOR: `Launch-${name}`,
  ERP_LAUNCH_MARK: `LaunchMark-${name}`,
  ERP_URL: h.url,
};
for (const [k, v] of Object.entries(settings)) console.log(`${k}=${v}`);

// The App target's two configurations in the Xcode project: the blocks that name its Info.plist.
const pbx = path.join(dir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const target = {
  PRODUCT_BUNDLE_IDENTIFIER: h.bundleId,
  ERP_DISPLAY_NAME: `"${h.homeName}"`,
  ERP_GOOGLE_CLIENT_ID: `"${h.googleClientId || ''}"`,
  ERP_APPICON: `"AppIcon-${name}"`,
  ERP_LAUNCH_COLOR: `"Launch-${name}"`,
  ERP_LAUNCH_MARK: `"LaunchMark-${name}"`,
};
let text = fs.readFileSync(pbx, 'utf8');
let found = 0;
text = text.replace(/(\t\t[0-9A-F]{24} \/\* (Debug|Release) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\t(?:baseConfigurationReference = [^\n]*\n\t\t\t)?buildSettings = \{\n)([\s\S]*?)(\n\t\t\t\};)/g,
  (all, open, config, body, close) => {
    if (!body.includes('INFOPLIST_FILE = App/Info.plist;')) return all;
    found++;
    const want = { ...target, CODE_SIGN_STYLE: 'Automatic' };
    const drop = ['DEVELOPMENT_TEAM', 'CODE_SIGN_IDENTITY', 'PROVISIONING_PROFILE_SPECIFIER'];
    if (sign && config === 'Release') {
      Object.assign(want, {
        CODE_SIGN_STYLE: 'Manual',
        DEVELOPMENT_TEAM: sign.team,
        CODE_SIGN_IDENTITY: '"Apple Distribution"',
        PROVISIONING_PROFILE_SPECIFIER: `"${sign.profile}"`,
      });
    }
    // One setting a line at this depth; a list (LD_RUNPATH_SEARCH_PATHS = ( … );) runs on deeper.
    const keyOf = (l) => /^\t{4}([A-Z_][A-Z0-9_]*) = /.exec(l)?.[1];
    let lines = body.split('\n').filter((l) => !(keyOf(l) && drop.includes(keyOf(l)) && !(keyOf(l) in want)));
    for (const [k, v] of Object.entries(want)) {
      const line = `\t\t\t\t${k} = ${v};`;
      const at = lines.findIndex((l) => keyOf(l) === k);
      if (at >= 0) { lines[at] = line; continue; }
      // In Xcode's order, so a dressed project diffs cleanly.
      const after = lines.findIndex((l) => keyOf(l) && keyOf(l) > k);
      lines.splice(after < 0 ? lines.length : after, 0, line);
    }
    return open + lines.join('\n') + close;
  });
if (found !== 2) {
  console.error(`expected the App target's Debug and Release configurations in project.pbxproj, found ${found}`);
  process.exit(1);
}
fs.writeFileSync(pbx, text);
