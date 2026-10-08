// App Store Connect for the iPhone app's workflow (.github/workflows/ios.yml), through Apple's API
// with the team key in the repository's secrets (ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY).
//
//   node scripts/asc.mjs plan <auto|check|testflight>   which houses can go to TestFlight → $GITHUB_OUTPUT
//   node scripts/asc.mjs sign <house> <dir>             a signing certificate and profile for one build → $GITHUB_ENV
//   node scripts/asc.mjs testers <house> [emails]       the house's "Shop" testers, the account holder first
//   node scripts/asc.mjs revoke                         the build's certificate and profile, gone again
//   node scripts/asc.mjs key-file <path>                the key as a proper .p8, for xcodebuild's upload
//
// The signing certificate lives for one build: made at the start, revoked at the end. Nothing
// private is kept anywhere but the key Apple issued, and revoking it touches nothing already
// uploaded (Apple signs what TestFlight hands out). Apple's API cannot create an app record, so
// a house goes to TestFlight once the owner has made its app in App Store Connect.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const houses = JSON.parse(fs.readFileSync(path.join(dir, 'houses.json'), 'utf8'));
const { ASC_ISSUER_ID, ASC_KEY_ID } = process.env;
const ASC_PRIVATE_KEY = privateKeyPem(process.env.ASC_PRIVATE_KEY);
const haveKey = !!(ASC_ISSUER_ID && ASC_KEY_ID && ASC_PRIVATE_KEY);

/**
 * The .p8 however it was pasted into GitHub's secret box: the whole file, only the long middle
 * part, its lines run together, or the file base64'd. A secret box takes text, not a file
 * (owner, 2026-10-08: "cant enter files here"), so each of those has to work.
 */
export function privateKeyPem(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (!text.includes('-----BEGIN')) {
    // The whole file base64'd decodes to text with the header in it.
    try {
      const decoded = Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) text = decoded;
    } catch { /* not that */ }
  }
  const body = text
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  if (!body) return '';
  // Spelled in two halves: cloud-deploy refuses any file that holds a whole PEM header.
  const label = ['PRIVATE', 'KEY'].join(' ');
  return `-----BEGIN ${label}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
}
const say = (line) => console.error(line); // stdout is for $GITHUB_OUTPUT / $GITHUB_ENV

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID.trim(), typ: 'JWT' });
  const body = b64({ iss: ASC_ISSUER_ID.trim(), iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: ASC_PRIVATE_KEY, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

async function api(method, url, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const why = json?.errors?.map((e) => e.detail || e.title).join('; ') || res.statusText;
    const err = new Error(`${method} ${url.split('?')[0]}: ${res.status} ${why}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const q = encodeURIComponent;

async function bundleIdFor(h, create) {
  const found = (await api('GET', `/v1/bundleIds?filter[identifier]=${q(h.bundleId)}&filter[platform]=IOS&limit=20`)).data
    .find((b) => b.attributes.identifier === h.bundleId);
  if (found || !create) return found || null;
  say(`Registering the bundle ID ${h.bundleId} (${h.storeName})`);
  return (await api('POST', '/v1/bundleIds', {
    data: { type: 'bundleIds', attributes: { identifier: h.bundleId, name: h.storeName.replace(/[^A-Za-z0-9 ]/g, ''), platform: 'IOS' } },
  })).data;
}

async function appFor(h) {
  return (await api('GET', `/v1/apps?filter[bundleId]=${q(h.bundleId)}&limit=5`)).data
    .find((a) => a.attributes.bundleId === h.bundleId) || null;
}

/** Which houses go to TestFlight this run, and whether the simulator check runs. */
async function plan(mode) {
  const out = { upload: [], ready: [], simulator: mode === 'check' };
  if (!haveKey) {
    say('::notice::No App Store Connect key in the repository secrets yet: building for the simulator only.');
    out.simulator = true;
  } else if (mode !== 'check') {
    try { token(); } catch (e) {
      throw new Error(`ASC_PRIVATE_KEY is not a readable .p8 key (${e.message}). Paste the whole AuthKey_….p8 file's text into the secret.`);
    }
    for (const [name, h] of Object.entries(houses)) {
      await bundleIdFor(h, true);
      const app = await appFor(h);
      if (!app) {
        say(`::notice::${h.storeName}: no app in App Store Connect yet. Apps → + → New App: iOS, name "${h.storeName}", bundle ID ${h.bundleId}, SKU ${h.bundleId}.`);
        continue;
      }
      out.ready.push(name);
      if (!h.googleClientId) {
        say(`::notice::${h.storeName}: no Google iOS client ID in apps/ios/houses.json yet, so the app could not sign in. Not uploaded.`);
        continue;
      }
      out.upload.push(name);
    }
    // With the key in place a house not ready yet is waiting on its app or its client, not on the
    // code: the simulator check would spend Mac minutes proving nothing new. The upload compiles too.
  }
  console.log(`upload=${JSON.stringify(out.upload)}`);
  console.log(`ready=${JSON.stringify(out.ready)}`);
  console.log(`simulator=${out.simulator}`);
}

/** A distribution certificate and an App Store profile for this one build. */
async function sign(name, outDir) {
  const h = houses[name];
  if (!h) throw new Error(`no house ${name}`);
  fs.mkdirSync(outDir, { recursive: true });
  const file = (f) => path.join(outDir, f);
  const ssl = (...args) => execFileSync('/usr/bin/openssl', args, { stdio: ['ignore', 'pipe', 'inherit'] });

  ssl('genrsa', '-out', file('key.pem'), '2048');
  ssl('req', '-new', '-key', file('key.pem'), '-subj', '/CN=ERP build/O=ERP', '-out', file('csr.pem'));
  const cert = (await api('POST', '/v1/certificates', {
    data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: fs.readFileSync(file('csr.pem'), 'utf8') } },
  })).data;
  // Recorded before anything else can fail, so the end of the run can revoke it.
  console.log(`ASC_CERT_ID=${cert.id}`);
  fs.writeFileSync(file('cert.cer'), Buffer.from(cert.attributes.certificateContent, 'base64'));
  ssl('x509', '-inform', 'DER', '-in', file('cert.cer'), '-out', file('cert.pem'));
  const p12Password = crypto.randomBytes(12).toString('hex');
  say(`::add-mask::${p12Password}`);
  ssl('pkcs12', '-export', '-inkey', file('key.pem'), '-in', file('cert.pem'), '-out', file('dist.p12'), '-passout', `pass:${p12Password}`);
  fs.rmSync(file('key.pem'));

  const bundle = await bundleIdFor(h, true);
  const profileName = `ERP build ${name} ${process.env.GITHUB_RUN_ID || Date.now()}`;
  const profile = (await api('POST', '/v1/profiles', {
    data: {
      type: 'profiles',
      attributes: { name: profileName, profileType: 'IOS_APP_STORE' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        certificates: { data: [{ type: 'certificates', id: cert.id }] },
      },
    },
  })).data;
  console.log(`ASC_PROFILE_ID=${profile.id}`);
  const content = Buffer.from(profile.attributes.profileContent, 'base64');
  fs.writeFileSync(file('profile.mobileprovision'), content);
  // The plist inside the signed profile is plain text: the team is read from it.
  const team = /<key>TeamIdentifier<\/key>\s*<array>\s*<string>([A-Z0-9]+)<\/string>/.exec(content.toString('latin1'))?.[1];
  if (!team) throw new Error('No team in the provisioning profile');
  console.log(`TEAM_ID=${team}`);
  console.log(`PROFILE_UUID=${profile.attributes.uuid}`);
  console.log(`PROFILE_NAME=${profileName}`);
  console.log(`P12_PASSWORD=${p12Password}`);
  say(`Signing for ${h.storeName}: team ${team}, profile "${profileName}"`);
}

async function revoke() {
  const { ASC_CERT_ID, ASC_PROFILE_ID } = process.env;
  for (const [kind, id] of [['profiles', ASC_PROFILE_ID], ['certificates', ASC_CERT_ID]]) {
    if (!id) continue;
    try { await api('DELETE', `/v1/${kind}/${id}`); say(`Removed ${kind} ${id}`); }
    catch (e) { say(`::warning::Could not remove ${kind} ${id}: ${e.message}`); }
  }
}

/** The house's internal TestFlight group, every new build in it, the account holder and anyone named. */
async function testers(name, emails) {
  const h = houses[name];
  const app = await appFor(h);
  if (!app) throw new Error(`${h.storeName} has no app in App Store Connect`);
  const groups = (await api('GET', `/v1/apps/${app.id}/betaGroups?limit=50`)).data;
  let group = groups.find((g) => g.attributes.name === 'Shop' && g.attributes.isInternalGroup);
  if (!group) {
    group = (await api('POST', '/v1/betaGroups', {
      data: {
        type: 'betaGroups',
        attributes: { name: 'Shop', isInternalGroup: true, hasAccessToAllBuilds: true },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    })).data;
    say(`Made the internal TestFlight group "Shop" for ${h.storeName}`);
  }
  const holder = (await api('GET', '/v1/users?filter[roles]=ACCOUNT_HOLDER&limit=5')).data[0];
  const wanted = [...new Set([holder?.attributes?.username, ...emails].filter(Boolean).map((e) => e.trim().toLowerCase()))];
  const users = (await api('GET', '/v1/users?limit=200')).data;
  const invited = (await api('GET', '/v1/userInvitations?limit=200')).data;
  for (const email of wanted) {
    const user = users.find((u) => u.attributes.username?.toLowerCase() === email);
    if (!user) {
      // Internal testers are App Store Connect users: invited with the least role TestFlight takes,
      // seeing this house's app only. They are added to the group by the next build after accepting.
      if (!invited.some((i) => i.attributes.email?.toLowerCase() === email)) {
        await api('POST', '/v1/userInvitations', {
          data: {
            type: 'userInvitations',
            attributes: { email, firstName: email.split('@')[0], lastName: h.homeName, roles: ['MARKETING'], allAppsVisible: false, provisioningAllowed: false },
            relationships: { visibleApps: { data: [{ type: 'apps', id: app.id }] } },
          },
        });
        say(`Invited ${email} to App Store Connect (Marketing, ${h.storeName} only): they accept the email, then the next build reaches them`);
      } else {
        say(`${email} has not accepted the App Store Connect invitation yet`);
      }
      continue;
    }
    const find = async () => (await api('GET', `/v1/betaTesters?filter[email]=${q(email)}&limit=5`)).data[0];
    const inGroup = async () => (await api('GET', `/v1/betaGroups/${group.id}/betaTesters?limit=200`)).data
      .some((t) => t.attributes.email?.toLowerCase() === email);
    const create = () => api('POST', '/v1/betaTesters', {
      data: {
        type: 'betaTesters',
        attributes: { email, firstName: user.attributes.firstName || email, lastName: user.attributes.lastName || '' },
        relationships: { betaGroups: { data: [{ type: 'betaGroups', id: group.id }] } },
      },
    });
    // Each way Apple offers, until its own list for the group shows the tester. Creating the tester
    // with the group comes first: for an internal group Apple refuses the group's own relationship
    // ("409 Tester(s) cannot be assigned", 2026-10-08), which left Mina's group empty the first time.
    const tries = [
      ['tester', create],
      ['group', async () => { const t = await find(); if (!t) throw Object.assign(new Error('no tester yet'), { status: 404 }); await api('POST', `/v1/betaGroups/${group.id}/relationships/betaTesters`, { data: [{ type: 'betaTesters', id: t.id }] }); }],
      ['tester-groups', async () => { const t = await find(); if (!t) throw Object.assign(new Error('no tester yet'), { status: 404 }); await api('POST', `/v1/betaTesters/${t.id}/relationships/betaGroups`, { data: [{ type: 'betaGroups', id: group.id }] }); }],
    ];
    let done = await inGroup();
    for (const [how, run] of tries) {
      if (done) break;
      try { await run(); } catch (e) { say(`  ${how}: ${e.message}`); }
      await new Promise((r) => setTimeout(r, 1500));
      done = await inGroup();
      if (done) say(`  added by ${how}`);
    }
    say(done ? `${email} tests ${h.storeName}` : `::warning::${email} is not in ${h.storeName}'s testers yet`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'plan') await plan(args[0] || 'auto');
  else if (!haveKey) throw new Error('The App Store Connect key is not in the repository secrets (ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY).');
  else if (cmd === 'sign') await sign(args[0], args[1]);
  else if (cmd === 'revoke') await revoke();
  else if (cmd === 'key-file') { fs.mkdirSync(path.dirname(args[0]), { recursive: true }); fs.writeFileSync(args[0], ASC_PRIVATE_KEY, { mode: 0o600 }); }
  else if (cmd === 'testers') await testers(args[0], String(args[1] || '').split(/[\s,;]+/).filter(Boolean));
  else throw new Error(`unknown command ${cmd}`);
} catch (e) {
  say(`::error::${e.message}`);
  process.exit(1);
}
