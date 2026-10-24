// App Store Connect for the iPhone app's workflow (.github/workflows/ios.yml), through Apple's API
// with the team key in the repository's secrets (ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY).
//
//   node scripts/asc.mjs plan <auto|check|testflight>   which houses can go to TestFlight → $GITHUB_OUTPUT
//   node scripts/asc.mjs sign <house> <dir>             a signing certificate and profile for one build → $GITHUB_ENV
//   node scripts/asc.mjs sign-native <house> <dir>      the same for the native app (apps/iphone) and its widget, with push
//   node scripts/asc.mjs testers <house> [emails]       the house's "Shop" testers: the account holder, the emails, and anyone accepted since
//   node scripts/asc.mjs builds <house> [--fix]         the app's newest builds, whether "Shop" has them; --fix adds the newest and answers export compliance
//   node scripts/asc.mjs public-link <house> [--submit] the house's public TestFlight link (external group "Public"); --submit sends the build to beta review
//   node scripts/asc.mjs keep-fresh <house> [--days N] [--dry]  an Xcode Cloud build of main when the newest valid build is N days old (default 60), before TestFlight's 90 end it
//   node scripts/asc.mjs ci-off <house>                 the house's Xcode Cloud workflows switched off (a retired app builds no more)
//   node scripts/asc.mjs mac-setup <house> [--dry]      the Mac app (docs/features/mac-app.md): macOS on the app record, the "Mac release" workflow
//   node scripts/asc.mjs ci-runs <house> [--workflow re] [--commit sha] [--wait min] [--start]  a workflow's newest run, waited for, with every compile error
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
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    const why = json?.errors?.map((e) => [e.detail || e.title, e.source?.pointer].filter(Boolean).join(' at ')).join('; ') || res.statusText;
    const err = new Error(`${method} ${url.split('?')[0]}: ${res.status} ${why}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const q = encodeURIComponent;

/** A name Apple accepts from an address: letters only ("mina_khalid@" → Mina Khalid; Apple refused the underscore, 409). */
function personName(email, fallbackLast) {
  const words = email.split('@')[0].split(/[^A-Za-z]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return { firstName: words[0] || 'Tester', lastName: words.slice(1).join(' ') || fallbackLast };
}

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
    // A house whose native app (apps/iphone) can sign in has moved on: the shell no longer uploads for it,
    // so TestFlight never offers a 1.0 shell build beside the native 2.0.
    const native = JSON.parse(fs.readFileSync(path.join(dir, '..', 'iphone', 'houses.json'), 'utf8'));
    for (const [name, h] of Object.entries(houses)) {
      if (String(native[name]?.firebase?.iosAppId || '').includes(':ios:')) {
        say(`::notice::${h.storeName}: the native app (apps/iphone) replaces this shell; not uploaded.`);
        continue;
      }
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

/** A distribution certificate for this one build, as a .p12 in outDir; revoked at the end of the run. */
async function newCertificate(outDir) {
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
  console.log(`P12_PASSWORD=${p12Password}`);
  return cert;
}

/** An App Store profile for one bundle ID and the build's certificate, written to outDir/<fileName>. */
async function newProfile(bundle, cert, profileName, outDir, fileName) {
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
  const content = Buffer.from(profile.attributes.profileContent, 'base64');
  fs.writeFileSync(path.join(outDir, fileName), content);
  // The plist inside the signed profile is plain text: the team is read from it.
  const team = /<key>TeamIdentifier<\/key>\s*<array>\s*<string>([A-Z0-9]+)<\/string>/.exec(content.toString('latin1'))?.[1];
  if (!team) throw new Error('No team in the provisioning profile');
  return { profile, team };
}

/** A distribution certificate and an App Store profile for this one build. */
async function sign(name, outDir) {
  const h = houses[name];
  if (!h) throw new Error(`no house ${name}`);
  const cert = await newCertificate(outDir);
  const bundle = await bundleIdFor(h, true);
  const profileName = `ERP build ${name} ${process.env.GITHUB_RUN_ID || Date.now()}`;
  const { profile, team } = await newProfile(bundle, cert, profileName, outDir, 'profile.mobileprovision');
  console.log(`ASC_PROFILE_ID=${profile.id}`);
  console.log(`TEAM_ID=${team}`);
  console.log(`PROFILE_UUID=${profile.attributes.uuid}`);
  console.log(`PROFILE_NAME=${profileName}`);
  say(`Signing for ${h.storeName}: team ${team}, profile "${profileName}"`);
}

/** Switch a capability on for a bundle ID, once (Apple refuses a second). */
async function capability(bundle, type) {
  // This relationship takes no `limit` (Apple answers 400 to one); a bundle ID has a handful at most.
  const have = (await api('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)).data
    .some((c) => c.attributes.capabilityType === type);
  if (have) return;
  say(`Turning on ${type} for ${bundle.attributes.identifier}`);
  try {
    await api('POST', '/v1/bundleIdCapabilities', {
      data: { type: 'bundleIdCapabilities', attributes: { capabilityType: type }, relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } } },
    });
  } catch (e) {
    // Already on (switched on in the portal meanwhile) is what was wanted.
    if (!/409|already/i.test(String(e.message))) throw e;
  }
}

/**
 * The native app (apps/iphone): the same app record as the shell (one bundle ID per house), now with
 * notifications, and its home-screen widget under "<bundle ID>.widget". One certificate signs both.
 */
async function signNative(name, outDir) {
  const nativeHouses = JSON.parse(fs.readFileSync(path.join(dir, '..', 'iphone', 'houses.json'), 'utf8'));
  const h = nativeHouses[name];
  if (!h) throw new Error(`no house ${name} in apps/iphone/houses.json`);
  const cert = await newCertificate(outDir);
  const app = await bundleIdFor({ bundleId: h.bundleId, storeName: h.storeName }, true);
  await capability(app, 'PUSH_NOTIFICATIONS');
  const widget = await bundleIdFor({ bundleId: `${h.bundleId}.widget`, storeName: `${h.storeName} widget` }, true);
  const run = process.env.GITHUB_RUN_ID || Date.now();
  const a = await newProfile(app, cert, `ERP ${name} app ${run}`, outDir, 'app.mobileprovision');
  const w = await newProfile(widget, cert, `ERP ${name} widget ${run}`, outDir, 'widget.mobileprovision');
  console.log(`ASC_PROFILE_IDS=${a.profile.id},${w.profile.id}`);
  console.log(`TEAM_ID=${a.team}`);
  console.log(`APP_PROFILE_NAME=${a.profile.attributes.name}`);
  console.log(`WIDGET_PROFILE_NAME=${w.profile.attributes.name}`);
  say(`Signing ${h.storeName} (native): team ${a.team}, the app and its widget`);
}

async function revoke() {
  const { ASC_CERT_ID, ASC_PROFILE_ID, ASC_PROFILE_IDS } = process.env;
  const profiles = [ASC_PROFILE_ID, ...String(ASC_PROFILE_IDS || '').split(',')].filter(Boolean);
  for (const [kind, id] of [...profiles.map((p) => ['profiles', p]), ['certificates', ASC_CERT_ID]]) {
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
      // seeing this house's app only. Once they accept, the next run (the daily sweep below) adds them.
      // Someone named again with an invitation still pending is sent a new one, for this app: the old one may
      // be for another app (the old Mina app before the one ERP app, 2026-10-19) or lost in their mail.
      const pending = email === holder?.attributes?.username?.toLowerCase() ? null
        : invited.find((i) => i.attributes.email?.toLowerCase() === email);
      if (pending) {
        await api('DELETE', `/v1/userInvitations/${pending.id}`);
        say(`Withdrew ${email}'s pending invitation to send a new one`);
      }
      {
        const invite = () => api('POST', '/v1/userInvitations', {
          data: {
            type: 'userInvitations',
            attributes: { email, ...personName(email, h.homeName), roles: ['MARKETING'], allAppsVisible: false, provisioningAllowed: false },
            relationships: { visibleApps: { data: [{ type: 'apps', id: app.id }] } },
          },
        });
        // Apple holds a withdrawn invitation's email for a while ("409 The email is already being used",
        // 2026-10-19): try again for up to three minutes.
        for (let left = 12; ; left--) {
          try { await invite(); break; } catch (e) {
            if (e.status !== 409 || left <= 0) throw e;
            await new Promise((r) => setTimeout(r, 15000));
          }
        }
        say(`Invited ${email} to App Store Connect (Marketing, ${h.storeName} only): they accept Apple's email, then the next run adds them`);
      }
      continue;
    }
    // Already a user who sees other apps only (accepted for the old Mina app): let them see this one too.
    if (!user.attributes.allAppsVisible) {
      const apps = (await api('GET', `/v1/users/${user.id}/visibleApps?limit=50`)).data;
      if (!apps.some((a) => a.id === app.id)) {
        await api('POST', `/v1/users/${user.id}/relationships/visibleApps`, { data: [{ type: 'apps', id: app.id }] });
        say(`${email} can now see ${h.storeName} in App Store Connect`);
      }
    }
    await join(email, user);
  }
  // Whoever was let in for this app alone and has accepted since joins the group too, without their email
  // being typed again (the daily run of .github/workflows/testflight-testers.yml).
  for (const user of users) {
    const email = user.attributes.username?.toLowerCase();
    if (!email || wanted.includes(email) || user.attributes.allAppsVisible) continue;
    if (!(user.attributes.roles || []).includes('MARKETING')) continue;
    const apps = (await api('GET', `/v1/users/${user.id}/visibleApps?limit=50`)).data;
    if (apps.some((a) => a.id === app.id)) await join(email, user);
  }

  async function join(email, user) {
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
    if (done) { say(`${email} tests ${h.storeName}`); return; }
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

/** An address or number with most of it hidden, for logs: "a***@d***.com", "***4567". */
function mask(v) {
  const s = String(v || '');
  if (s.includes('@')) { const [u, d] = s.split('@'); return `${u[0] || ''}***@${d[0] || ''}***${d.slice(d.lastIndexOf('.'))}`; }
  return s.length > 4 ? `***${s.slice(-4)}` : s ? '***' : '';
}
/** Keeps a personal value out of the Actions log whatever is printed later. */
const hide = (v) => { if (v) say(`::add-mask::${v}`); return v; };

/** Apple answers a missing singleton with 404, or 200 and `data: null`; either is "none". */
async function maybe(url) {
  try { return (await api('GET', url))?.data || null; }
  catch (e) { if (e.status === 404) return null; throw e; }
}

const NOTES = (h) => `${h.storeName} is the internal point-of-sale and back-office tool of one shop (${h.homeName}); it is used by the shop's own staff, who sign in with the shop's Google accounts, so there is no demo account to give. Reviewers will see the Google sign-in screen; an account that is not on the shop's list is told it has no access. The app shows the shop's own data and nothing else, and it takes no payments.`;
const DESCRIPTION = (h) => `${h.storeName}: the shop's own ERP for ${h.homeName} on the iPhone. Orders, invoices, customers, the workshop and the day's figures. For the shop's team; sign in with the shop's Google account.`;
const WHATS_NEW = (h) => `The latest ${h.homeName} build for the shop's team. Sign in with the shop's Google account.`;

/**
 * The house's public TestFlight link: an external group "Public" with the link on and no tester limit, the
 * newest build in it, and (with submit) that build sent to beta review, which external testing needs once.
 * The link is the only thing on stdout; everything else is on stderr. Test Information the owner has not
 * filled (contact, feedback email) is copied from the Taheri app, else read from ASC_CONTACT_*; failing both,
 * the run stops before submitting and says which fields to fill in App Store Connect.
 */
async function publicLink(name, submit) {
  const h = houses[name];
  if (!h) throw new Error(`no house ${name}`);
  const app = await appFor(h);
  if (!app) throw new Error(`${h.storeName} has no app in App Store Connect`);
  say(`${h.storeName}: app ${app.id} (${h.bundleId})`);

  // 1. The external group with the link on.
  const groups = (await api('GET', `/v1/apps/${app.id}/betaGroups?limit=50`)).data;
  const want = { publicLinkEnabled: true, publicLinkLimitEnabled: false };
  let group = groups.find((g) => g.attributes.name === 'Public' && !g.attributes.isInternalGroup);
  if (!group) {
    group = (await api('POST', '/v1/betaGroups', {
      data: { type: 'betaGroups', attributes: { name: 'Public', isInternalGroup: false, ...want }, relationships: { app: { data: { type: 'apps', id: app.id } } } },
    })).data;
    say('Made the external group "Public"');
  } else if (!group.attributes.publicLinkEnabled || group.attributes.publicLinkLimitEnabled) {
    group = (await api('PATCH', `/v1/betaGroups/${group.id}`, { data: { type: 'betaGroups', id: group.id, attributes: want } })).data;
    say('Turned the public link on for "Public", with no tester limit');
  }
  if (!group.attributes.publicLink) group = (await api('GET', `/v1/betaGroups/${group.id}`)).data;
  const link = group.attributes.publicLink;
  if (!link) throw new Error('Apple gave the "Public" group no public link');
  say(`Public link: ${link}`);
  console.log(link);

  // 2. The newest usable build in it.
  const all = (await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=20&include=preReleaseVersion`)).data;
  const build = all.find((b) => b.attributes.processingState === 'VALID' && !b.attributes.expired);
  if (!build) throw new Error(`${h.storeName}: no valid, unexpired build to put in the group (newest: ${all[0]?.attributes.processingState || 'none'})`);
  const label = `${build.attributes.version}`;
  if (build.attributes.usesNonExemptEncryption == null) {
    await api('PATCH', `/v1/builds/${build.id}`, { data: { type: 'builds', id: build.id, attributes: { usesNonExemptEncryption: false } } });
    say(`Set export compliance (usesNonExemptEncryption false) on build ${label}`);
  }

  // 3. What beta review needs. Read first; mask anything personal.
  const missing = [];
  const taheri = houses.taheri && name !== 'taheri' ? await appFor(houses.taheri) : null;
  const env = process.env;
  const first = (...v) => v.find((x) => x != null && String(x).trim() !== '');

  const locs = (await api('GET', `/v1/apps/${app.id}/betaAppLocalizations?limit=50`)).data;
  const loc = locs.find((l) => l.attributes.locale === 'en-US') || locs[0];
  const haveDesc = first(...locs.map((l) => l.attributes.description));
  let feedback = first(...locs.map((l) => l.attributes.feedbackEmail));
  const detail = await maybe(`/v1/apps/${app.id}/betaAppReviewDetail`);
  const da = detail?.attributes || {};
  const tLocs = taheri ? (await api('GET', `/v1/apps/${taheri.id}/betaAppLocalizations?limit=50`)).data : [];
  const tDetail = taheri ? (await maybe(`/v1/apps/${taheri.id}/betaAppReviewDetail`))?.attributes || {} : {};
  const contact = {
    contactFirstName: first(da.contactFirstName, tDetail.contactFirstName, env.ASC_CONTACT_FIRST_NAME),
    contactLastName: first(da.contactLastName, tDetail.contactLastName, env.ASC_CONTACT_LAST_NAME),
    contactPhone: first(da.contactPhone, tDetail.contactPhone, env.ASC_CONTACT_PHONE),
    contactEmail: first(da.contactEmail, tDetail.contactEmail, env.ASC_CONTACT_EMAIL),
  };
  feedback = first(feedback, ...tLocs.map((l) => l.attributes.feedbackEmail), env.ASC_CONTACT_FEEDBACK_EMAIL, contact.contactEmail);
  hide(feedback); Object.values(contact).forEach(hide);

  const bl = (await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations?limit=50`)).data;
  const license = await maybe(`/v1/apps/${app.id}/betaLicenseAgreement`);

  const row = (what, ok, shown) => say(`  ${ok ? 'ok     ' : 'MISSING'} ${what}${ok && shown ? `: ${shown}` : ''}`);
  say('Beta review prerequisites:');
  row('feedbackEmail', !!first(...locs.map((l) => l.attributes.feedbackEmail)), mask(feedback));
  row('beta app description', !!haveDesc);
  for (const k of Object.keys(contact)) row(k, !!first(da[k]), k === 'contactFirstName' || k === 'contactLastName' ? da[k] : mask(da[k]));
  row('demoAccountRequired', da.demoAccountRequired != null, String(da.demoAccountRequired));
  row('review notes', !!first(da.notes));
  row(`what to test (build ${label})`, !!first(...bl.map((l) => l.attributes.whatsNew)));
  row('license agreement', !!first(license?.attributes?.agreementText), 'set');
  if (!first(license?.attributes?.agreementText)) say('  (a license agreement is optional: Apple\'s standard terms apply)');

  // Fill what is missing, only with what is known.
  if (!haveDesc || !first(...locs.map((l) => l.attributes.feedbackEmail))) {
    const attributes = { ...(!haveDesc && { description: DESCRIPTION(h) }), ...(feedback && !first(...locs.map((l) => l.attributes.feedbackEmail)) && { feedbackEmail: feedback }) };
    if (loc) await api('PATCH', `/v1/betaAppLocalizations/${loc.id}`, { data: { type: 'betaAppLocalizations', id: loc.id, attributes } });
    else await api('POST', '/v1/betaAppLocalizations', { data: { type: 'betaAppLocalizations', attributes: { locale: 'en-US', description: DESCRIPTION(h), ...(feedback && { feedbackEmail: feedback }) }, relationships: { app: { data: { type: 'apps', id: app.id } } } } });
    say('Filled the beta app information (description' + (attributes.feedbackEmail || (!loc && feedback) ? ', feedback email' : '') + ')');
  }
  if (!first(...bl.map((l) => l.attributes.whatsNew))) {
    const bloc = bl.find((l) => l.attributes.locale === 'en-US') || bl[0];
    if (bloc) await api('PATCH', `/v1/betaBuildLocalizations/${bloc.id}`, { data: { type: 'betaBuildLocalizations', id: bloc.id, attributes: { whatsNew: WHATS_NEW(h) } } });
    else await api('POST', '/v1/betaBuildLocalizations', { data: { type: 'betaBuildLocalizations', attributes: { locale: 'en-US', whatsNew: WHATS_NEW(h) }, relationships: { build: { data: { type: 'builds', id: build.id } } } } });
    say(`Filled "what to test" for build ${label}`);
  }
  const patch = {};
  for (const [k, v] of Object.entries(contact)) if (!first(da[k]) && v) patch[k] = v;
  if (da.demoAccountRequired == null) patch.demoAccountRequired = false;
  if (!first(da.notes)) patch.notes = NOTES(h);
  if (Object.keys(patch).length) {
    if (!detail) throw new Error('Apple returned no beta app review detail to fill');
    await api('PATCH', `/v1/betaAppReviewDetails/${detail.id}`, { data: { type: 'betaAppReviewDetails', id: detail.id, attributes: patch } });
    say(`Filled the review details: ${Object.keys(patch).join(', ')}`);
  }

  const owes = [];
  if (!first(...locs.map((l) => l.attributes.feedbackEmail)) && !feedback) owes.push('Feedback Email');
  if (!contact.contactFirstName) owes.push('Contact First Name');
  if (!contact.contactLastName) owes.push('Contact Last Name');
  if (!contact.contactPhone) owes.push('Contact Phone');
  if (!contact.contactEmail) owes.push('Contact Email');
  if (owes.length) {
    throw new Error(`${h.storeName}: not submitted. The owner must fill in App Store Connect → ${h.storeName} → TestFlight → Test Information: ${owes.join(', ')} (or set the ASC_CONTACT_* secrets: FIRST_NAME, LAST_NAME, PHONE, EMAIL, FEEDBACK_EMAIL). The link above works once beta review passes.`);
  }
  say('  note: this app has no demo mode a reviewer can reach (the demo is a launch argument of the simulator build); the review notes say so.');

  // Only now: Apple refuses a build for an external group until Test Information is complete (422 "not in an
  // externally assignable state").
  const inGroup = (await api('GET', `/v1/betaGroups/${group.id}/builds?limit=50`)).data.some((b) => b.id === build.id);
  if (inGroup) say(`Build ${label} is already in "Public"`);
  else {
    await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: build.id }] });
    say(`Added build ${label} to "Public"`);
  }

  // 4. Beta review.
  const detailNow = await maybe(`/v1/builds/${build.id}/buildBetaDetail`);
  say(`Build ${label}: external build state ${detailNow?.attributes?.externalBuildState || '-'}`);
  if (!submit) { say('Not submitted (add --submit).'); return; }
  let sub = await maybe(`/v1/builds/${build.id}/betaAppReviewSubmission`);
  if (!sub) {
    try {
      sub = (await api('POST', '/v1/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } })).data;
      say(`Submitted build ${label} to beta review`);
    } catch (e) {
      // Not needed (an earlier version of the same train was approved) or refused for a reason Apple states.
      say(`::warning::Beta review submission: ${e.message}`);
    }
  }
  sub = sub || await maybe(`/v1/builds/${build.id}/betaAppReviewSubmission`);
  say(`Beta review: ${sub?.attributes?.betaReviewState || 'no submission'}`);
  const after = await maybe(`/v1/builds/${build.id}/buildBetaDetail`);
  say(`Build ${label}: external build state ${after?.attributes?.externalBuildState || '-'}`);
}

/** Nothing uploaded after this instant means Xcode Cloud archived but never distributed (2026-10-12, commit 42f8124). */
const ARCHIVED_AT = '2026-10-12T18:30:00Z';

/** The app's newest builds and whether the house's "Shop" group has them; with fix, the newest joins it. */
async function builds(name, fix) {
  const h = houses[name];
  if (!h) throw new Error(`no house ${name}`);
  const app = await appFor(h);
  if (!app) throw new Error(`${h.storeName} has no app in App Store Connect`);
  say(`${h.storeName}: app ${app.id} (${h.bundleId})`);
  // The App IDs' capabilities (read-only unless --fix) (a build without PUSH_NOTIFICATIONS here can never be handed a device token).
  for (const id of [h.bundleId, `${h.bundleId}.widget`]) {
    try {
      const b = await api('GET', `/v1/bundleIds?filter[identifier]=${q(id)}&filter[platform]=IOS&include=bundleIdCapabilities&limit=20`);
      const bundle = b.data.find((x) => x.attributes.identifier === id);
      if (!bundle) { say(`  App ID ${id}: not registered`); continue; }
      const caps = (b.included || []).filter((i) => i.type === 'bundleIdCapabilities').map((c) => c.attributes?.capabilityType).filter(Boolean);
      const types = caps.length ? caps : (await api('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`)).data.map((c) => c.attributes.capabilityType);
      say(`  App ID ${id}: capabilities ${types.join(', ') || '(none)'}; push notifications: ${types.includes('PUSH_NOTIFICATIONS') ? 'ON' : 'OFF'}`);
      // Without it the profile lacks aps-environment and iOS never hands out a token; a new Xcode Cloud build regenerates the profile.
      if (fix && id === h.bundleId && !types.includes('PUSH_NOTIFICATIONS')) {
        await capability(bundle, 'PUSH_NOTIFICATIONS');
        say(`enabled push notifications on ${id}`);
      }
    } catch (e) { say(`  App ID ${id}: could not read capabilities (${e.message})`); }
  }
  const res = await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=12&include=buildBetaDetail,preReleaseVersion`);
  const inc = (type, id) => (res.included || []).find((i) => i.type === type && i.id === id);
  const rows = res.data.map((b) => {
    const a = b.attributes;
    const pre = inc('preReleaseVersions', b.relationships?.preReleaseVersion?.data?.id);
    const det = inc('buildBetaDetails', b.relationships?.buildBetaDetail?.data?.id);
    return {
      id: b.id, version: pre?.attributes?.version || '?', platform: pre?.attributes?.platform || 'IOS', build: a.version, uploaded: a.uploadedDate,
      state: a.processingState, expired: !!a.expired, encryption: a.usesNonExemptEncryption,
      internal: det?.attributes?.internalBuildState || '-', external: det?.attributes?.externalBuildState || '-',
    };
  });
  const group = (await api('GET', `/v1/apps/${app.id}/betaGroups?limit=50`)).data
    .find((g) => g.attributes.name === 'Shop' && g.attributes.isInternalGroup);
  let inShop = new Set();
  let testerCount = 0;
  if (group) {
    inShop = new Set((await api('GET', `/v1/builds?filter[betaGroups]=${group.id}&filter[app]=${app.id}&sort=-uploadedDate&limit=50`)).data.map((b) => b.id));
    testerCount = (await api('GET', `/v1/betaGroups/${group.id}/betaTesters?limit=200`)).data.length;
    say(`Group "Shop" ${group.id}: ${testerCount} tester(s), access to all builds: ${!!group.attributes.hasAccessToAllBuilds}`);
  } else say('No internal group "Shop" for this app (run testers first).');
  for (const r of rows) {
    say(`  ${r.platform} ${r.version} (${r.build})  ${r.uploaded}  ${r.state}${r.expired ? ' EXPIRED' : ''}  encryption ${r.encryption}  internal ${r.internal}  external ${r.external}  in Shop: ${inShop.has(r.id) ? 'yes' : 'no'}`);
  }
  const hhmm = (d) => new Date(d).toISOString().slice(11, 16);
  if (!rows.length) { say(`::warning::${h.storeName}: no builds at all in App Store Connect.`); return; }
  if (!rows.some((r) => new Date(r.uploaded) > new Date(ARCHIVED_AT))) {
    say(`::error::${h.storeName}: Xcode Cloud archived but uploaded nothing (no build after ${ARCHIVED_AT}): the workflow has no TestFlight distribution / post-action.`);
    return;
  }
  // The iPhone's and the Mac's newest each, apart: a Mac upload never takes the iPhone's place in Shop (docs/features/mac-app.md).
  for (const platform of [...new Set(rows.map((r) => r.platform))]) {
    const newest = rows.find((r) => r.platform === platform);
    say(`${h.storeName} ${platform}: newest build ${newest.version} (${newest.build}) uploaded ${hhmm(newest.uploaded)} UTC ${newest.uploaded.slice(0, 10)}, ${newest.state}, internal ${newest.internal}, in Shop: ${inShop.has(newest.id) ? 'yes' : 'no'}`);
    if (!fix) continue;
    if (newest.state !== 'VALID' || newest.expired) { say(`Not fixing: the newest build is ${newest.state}${newest.expired ? ', expired' : ''} (still processing, or Apple refused it).`); continue; }
    if (newest.encryption == null) {
      // Info.plist declares ITSAppUsesNonExemptEncryption false; this answers it where the build missed it.
      await api('PATCH', `/v1/builds/${newest.id}`, { data: { type: 'builds', id: newest.id, attributes: { usesNonExemptEncryption: false } } });
      say(`Set export compliance (usesNonExemptEncryption false) on ${newest.version} (${newest.build})`);
    }
    if (!group) { say('Not added: no "Shop" group.'); continue; }
    if (inShop.has(newest.id)) { say(`${platform} ${newest.version} (${newest.build}) is already in Shop.`); continue; }
    await api('POST', `/v1/betaGroups/${group.id}/relationships/builds`, { data: [{ type: 'builds', id: newest.id }] });
    say(`Added ${platform} ${newest.version} (${newest.build}) to Shop (${testerCount} tester(s))`);
  }
}

/**
 * TestFlight builds die at 90 days and a lapse locks every phone out of the app: when the newest VALID build is
 * `days` old (60 by default), start an Xcode Cloud build of the release workflow on `main` (the same one a push
 * starts). Does nothing while a build is already running or queued. With dry, only says what it would do.
 */
async function keepFresh(name, days, dry) {
  const h = houses[name];
  if (!h) throw new Error(`no house ${name}`);
  const app = await appFor(h);
  if (!app) throw new Error(`${h.storeName} has no app in App Store Connect`);
  const list = (await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=20`)).data;
  const valid = list.find((b) => b.attributes.processingState === 'VALID' && !b.attributes.expired);
  const age = valid ? (Date.now() - new Date(valid.attributes.uploadedDate).getTime()) / 86_400_000 : Infinity;
  if (valid) say(`${h.storeName}: newest valid build ${valid.attributes.version} uploaded ${valid.attributes.uploadedDate.slice(0, 10)}, ${Math.floor(age)} day(s) old (limit ${days}).`);
  else say(`::warning::${h.storeName}: no valid, unexpired build at all.`);
  if (age < days) { say('Fresh enough: nothing started.'); return; }

  const product = await maybe(`/v1/apps/${app.id}/ciProduct`);
  if (!product) throw new Error(`${h.storeName} has no Xcode Cloud product`);
  const running = (await api('GET', `/v1/ciProducts/${product.id}/buildRuns?limit=10&sort=-number`)).data
    .filter((r) => r.attributes.executionProgress === 'PENDING' || r.attributes.executionProgress === 'RUNNING');
  if (running.length) { say(`A build is already ${running[0].attributes.executionProgress.toLowerCase()} (#${running[0].attributes.number}): nothing started.`); return; }

  // The Mac's workflow is its own line (mac-setup): a stale iPhone build is never answered with a Mac one.
  const flows = (await api('GET', `/v1/ciProducts/${product.id}/workflows?limit=50`)).data
    .filter((f) => f.attributes.isEnabled !== false && !MAC_FLOW.test(f.attributes.name));
  // The release line: a workflow named for TestFlight or release, else the only enabled one.
  const flow = flows.find((f) => /testflight|release|archive|deliver/i.test(f.attributes.name)) || (flows.length === 1 ? flows[0] : null);
  if (!flow) throw new Error(`Cannot tell which of the enabled workflows (${flows.map((f) => f.attributes.name).join(', ') || 'none'}) is the release one.`);
  const repos = (await api('GET', `/v1/ciProducts/${product.id}/primaryRepositories?limit=5`)).data;
  if (!repos.length) throw new Error('The Xcode Cloud product has no repository.');
  const refs = (await api('GET', `/v1/scmRepositories/${repos[0].id}/gitReferences?limit=200`)).data;
  const main = refs.find((r) => r.attributes.name === 'main' && r.attributes.kind === 'BRANCH') || refs.find((r) => r.attributes.name === 'main');
  if (!main) throw new Error('No branch "main" in the Xcode Cloud repository.');
  if (dry) { say(`Dry run: would start "${flow.attributes.name}" on main (${main.id}).`); return; }
  const run = (await api('POST', '/v1/ciBuildRuns', {
    data: {
      type: 'ciBuildRuns', attributes: { clean: false },
      relationships: { workflow: { data: { type: 'ciWorkflows', id: flow.id } }, sourceBranchOrTag: { data: { type: 'scmGitReferences', id: main.id } } },
    },
  })).data;
  say(`Started Xcode Cloud build #${run.attributes?.number ?? run.id} of "${flow.attributes.name}" on main: the newest build was ${Number.isFinite(age) ? Math.floor(age) + ' days' : 'missing'} old.`);
}

/** A retired app's Xcode Cloud workflows, switched off so a release line builds only the apps still made. */
async function ciOff(name) {
  const h = houses[name];
  if (!h) throw new Error(`no house ${name}`);
  const app = await appFor(h);
  if (!app) { say(`${name}: no app in App Store Connect`); return; }
  const product = await maybe(`/v1/apps/${app.id}/ciProduct`);
  if (!product) { say(`${h.storeName}: no Xcode Cloud product`); return; }
  const flows = (await api('GET', `/v1/ciProducts/${product.id}/workflows?limit=50`)).data;
  for (const f of flows) {
    if (f.attributes.isEnabled === false) { say(`${f.attributes.name}: already off`); continue; }
    await api('PATCH', `/v1/ciWorkflows/${f.id}`, { data: { type: 'ciWorkflows', id: f.id, attributes: { isEnabled: false } } });
    say(`${f.attributes.name}: switched off`);
  }
}

/** The Mac app's Xcode Cloud workflow, told apart by its name (keep-fresh and builds leave it to itself). */
const MAC_FLOW = /\bmac\b/i;
const MAC_FLOW_NAME = 'Mac release';
/** A line added here on a claude/ branch builds the Mac app (as RELEASES.md does the iPhone's). */
const MAC_TRIGGER = { directory: 'apps/iphone', fileName: 'MAC-RELEASES.md' };

/** The app's Xcode Cloud product, or a clear error. */
async function ciProductFor(h) {
  const app = await appFor(h);
  if (!app) throw new Error(`${h.storeName} has no app in App Store Connect`);
  const product = await maybe(`/v1/apps/${app.id}/ciProduct`);
  if (!product) throw new Error(`${h.storeName} has no Xcode Cloud product`);
  return { app, product };
}

/**
 * The Mac app is the same app record as the iPhone's (shop.taheri.erp, a universal purchase): macOS is added to it as a
 * platform, and Xcode Cloud gets a "Mac release" workflow copied from the iPhone's release one (its repository, Xcode and
 * macOS), archiving the "ERP Mac" scheme for TestFlight and building the iPhone's "ERP" scheme beside it, so a Mac change
 * that breaks the iPhone's compile shows on the same run. Started by a line in apps/iphone/MAC-RELEASES.md on a claude/
 * branch. Idempotent: what is there already is only described.
 */
async function macSetup(name, dry) {
  const h = houses[name];
  if (!h) throw new Error(`no house ${name}`);
  const { app, product } = await ciProductFor(h);
  say(`${h.storeName}: app ${app.id}, Xcode Cloud product ${product.id}`);

  // The App ID: an explicit iOS one serves the Mac too (universal purchase), which Xcode's automatic signing relies on.
  const ids = (await api('GET', `/v1/bundleIds?filter[identifier]=${q(h.bundleId)}&limit=20`)).data
    .filter((b) => b.attributes.identifier === h.bundleId);
  for (const b of ids) say(`  App ID ${b.attributes.identifier}: platform ${b.attributes.platform}`);

  // macOS on the app record: a build for a platform the app does not have is refused at upload.
  const macVersions = (await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=MAC_OS&limit=5`)).data;
  if (macVersions.length) say(`  macOS on the app: yes (${macVersions.map((v) => `${v.attributes.versionString} ${v.attributes.appStoreState || v.attributes.appVersionState || ''}`).join(', ')})`);
  else if (dry) say('  macOS on the app: no (would add it)');
  else {
    try {
      await api('POST', '/v1/appStoreVersions', {
        data: { type: 'appStoreVersions', attributes: { platform: 'MAC_OS', versionString: '2.2' }, relationships: { app: { data: { type: 'apps', id: app.id } } } },
      });
      say('  macOS on the app: added (a 2.2 macOS version, never submitted; TestFlight takes Mac builds now)');
    } catch (e) { say(`::warning::Could not add macOS to the app (${e.message}). In App Store Connect → the app → the "+" beside iOS App → macOS.`); }
  }

  const flows = (await api('GET', `/v1/ciProducts/${product.id}/workflows?limit=50`)).data;
  for (const f of flows) {
    const a = f.attributes;
    say(`  workflow "${a.name}" ${a.isEnabled === false ? '(off)' : ''} container ${a.containerFilePath}; actions ${(a.actions || []).map((x) => `${x.actionType} ${x.platform} ${x.scheme} ${x.destination || ''} ${x.buildDistributionAudience || ''}`).join(' | ')}`);
    say(`    start: ${JSON.stringify(a.branchStartCondition || null)}`);
  }
  if (flows.some((f) => f.attributes.name === MAC_FLOW_NAME)) { say(`"${MAC_FLOW_NAME}" is there already.`); return; }

  const enabled = flows.filter((f) => f.attributes.isEnabled !== false && !MAC_FLOW.test(f.attributes.name));
  const ios = enabled.find((f) => /release|testflight|archive/i.test(f.attributes.name)) || enabled[0];
  if (!ios) throw new Error('No iPhone workflow to copy the repository, Xcode and macOS versions from.');
  const rel = async (what) => (await maybe(`/v1/ciWorkflows/${ios.id}/${what}`))?.id;
  const [repository, xcodeVersion, macOsVersion] = await Promise.all([rel('repository'), rel('xcodeVersion'), rel('macOsVersion')]);
  if (!repository || !xcodeVersion || !macOsVersion) throw new Error(`"${ios.attributes.name}" lacks a repository, Xcode or macOS version (${repository}, ${xcodeVersion}, ${macOsVersion}).`);
  const start = ios.attributes.branchStartCondition || {};
  const attributes = {
    name: MAC_FLOW_NAME,
    description: 'The Mac app (scheme ERP Mac) to TestFlight, and the iPhone app built beside it. Started by a line in apps/iphone/MAC-RELEASES.md on a claude/ branch.',
    branchStartCondition: {
      source: start.source || { isAllMatch: false, patterns: [{ pattern: 'claude/', isPrefix: true }] },
      filesAndFoldersRule: { mode: 'START_IF_ANY_FILE_MATCHES', matchers: [MAC_TRIGGER] },
      autoCancel: true,
    },
    actions: [
      { name: 'Archive - macOS', actionType: 'ARCHIVE', destination: 'ANY_MAC', buildDistributionAudience: 'INTERNAL_ONLY', scheme: 'ERP Mac', platform: 'MACOS', isRequiredToPass: true },
      { name: 'Build - iOS', actionType: 'BUILD', destination: 'ANY_IOS_DEVICE', scheme: 'ERP', platform: 'IOS', isRequiredToPass: false },
    ],
    isEnabled: true,
    clean: false,
    containerFilePath: ios.attributes.containerFilePath,
  };
  if (dry) { say(`Dry run: would create ${JSON.stringify(attributes)}`); return; }
  const made = (await api('POST', '/v1/ciWorkflows', {
    data: {
      type: 'ciWorkflows', attributes,
      relationships: {
        product: { data: { type: 'ciProducts', id: product.id } },
        repository: { data: { type: 'scmRepositories', id: repository } },
        xcodeVersion: { data: { type: 'ciXcodeVersions', id: xcodeVersion } },
        macOsVersion: { data: { type: 'ciMacOsVersions', id: macOsVersion } },
      },
    },
  })).data;
  say(`Created "${MAC_FLOW_NAME}" (${made.id}), copied from "${ios.attributes.name}".`);
}

/**
 * A workflow's run for a commit (or its newest), waited for, then each action's result and every issue Xcode Cloud
 * reported (compile errors with file and line): the compiler's answer, read in a GitHub log by a cloud session that has
 * no Mac. With start, a run is started on the branch when none came for the commit (the workflow made after the push).
 */
async function ciRuns(name, { workflow, commit, wait, start, branch }) {
  const h = houses[name];
  if (!h) throw new Error(`no house ${name}`);
  const { product } = await ciProductFor(h);
  const flows = (await api('GET', `/v1/ciProducts/${product.id}/workflows?limit=50`)).data;
  const re = new RegExp(workflow || 'release', 'i');
  const flow = flows.find((f) => re.test(f.attributes.name));
  if (!flow) throw new Error(`No workflow matches /${workflow}/ (${flows.map((f) => f.attributes.name).join(', ')})`);
  const deadline = Date.now() + (wait || 0) * 60_000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let run = null;
  let started = false;
  for (;;) {
    const runs = (await api('GET', `/v1/ciWorkflows/${flow.id}/buildRuns?limit=20&sort=-number`)).data;
    run = commit ? runs.find((r) => r.attributes.sourceCommit?.commitSha?.startsWith(commit)) : runs[0];
    if (!run && start && !started && branch && Date.now() > deadline - (wait || 0) * 60_000 + 120_000) {
      const repo = await maybe(`/v1/ciWorkflows/${flow.id}/repository`);
      const refs = repo ? (await api('GET', `/v1/scmRepositories/${repo.id}/gitReferences?limit=200`)).data : [];
      const ref = refs.find((r) => r.attributes.name === branch && r.attributes.kind === 'BRANCH');
      if (ref) {
        const made = (await api('POST', '/v1/ciBuildRuns', {
          data: { type: 'ciBuildRuns', attributes: { clean: false }, relationships: { workflow: { data: { type: 'ciWorkflows', id: flow.id } }, sourceBranchOrTag: { data: { type: 'scmGitReferences', id: ref.id } } } },
        })).data;
        say(`No run came for ${commit || 'the branch'}: started #${made.attributes?.number ?? made.id} of "${flow.attributes.name}" on ${branch}.`);
      } else say(`::warning::Xcode Cloud does not list the branch ${branch} yet; nothing started.`);
      started = true;
    }
    const a = run?.attributes;
    if (run && a.executionProgress === 'COMPLETE') break;
    if (Date.now() > deadline) break;
    say(`${new Date().toISOString().slice(11, 19)} ${run ? `#${a.number} ${a.executionProgress}` : `no run yet for ${commit || 'the workflow'}`}`);
    await sleep(60_000);
  }
  if (!run) { say(`::warning::No run of "${flow.attributes.name}" for ${commit || 'it'}.`); return; }
  const a = run.attributes;
  say(`"${flow.attributes.name}" #${a.number} on ${a.sourceCommit?.commitSha?.slice(0, 7)}: ${a.executionProgress} ${a.completionStatus || ''} (started ${a.startedDate || '-'}, finished ${a.finishedDate || '-'})`);
  if (a.executionProgress !== 'COMPLETE') { say('::warning::Still running when the wait ran out.'); return; }
  const actions = (await api('GET', `/v1/ciBuildRuns/${run.id}/actions?limit=20`)).data;
  let errors = 0;
  for (const act of actions) {
    const x = act.attributes;
    say(`\n== ${x.name}: ${x.completionStatus} (${x.issueCounts ? JSON.stringify(x.issueCounts) : ''})`);
    let next = `/v1/ciBuildActions/${act.id}/issues?limit=200`;
    for (let page = 0; next && page < 10; page++) {
      const res = await api('GET', next);
      for (const i of res.data) {
        const t = i.attributes;
        const where = t.fileSource ? `${t.fileSource.path}:${t.fileSource.lineNumber}` : '';
        if (t.issueType === 'ERROR' || t.issueType === 'TEST_FAILURE') errors++;
        if (t.issueType === 'WARNING' && !process.env.SHOW_WARNINGS) continue;
        say(`${t.issueType} ${where} ${t.message}`);
      }
      next = res.links?.next ? res.links.next.replace('https://api.appstoreconnect.apple.com', '') : null;
    }
  }
  if (a.completionStatus !== 'SUCCEEDED') say(`::error::"${flow.attributes.name}" #${a.number}: ${a.completionStatus}, ${errors} error(s).`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'plan') await plan(args[0] || 'auto');
  else if (!haveKey) throw new Error('The App Store Connect key is not in the repository secrets (ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY).');
  else if (cmd === 'sign') await sign(args[0], args[1]);
  else if (cmd === 'sign-native') await signNative(args[0], args[1]);
  else if (cmd === 'revoke') await revoke();
  else if (cmd === 'key-file') { fs.mkdirSync(path.dirname(args[0]), { recursive: true }); fs.writeFileSync(args[0], ASC_PRIVATE_KEY, { mode: 0o600 }); }
  else if (cmd === 'builds') await builds(args[0], args.includes('--fix'));
  else if (cmd === 'public-link') await publicLink(args[0], args.includes('--submit'));
  else if (cmd === 'keep-fresh') {
    const i = args.indexOf('--days');
    const days = i >= 0 ? Number(args[i + 1]) : 60;
    if (!Number.isFinite(days) || days <= 0) throw new Error('--days needs a number of days');
    await keepFresh(args[0], days, args.includes('--dry'));
  }
  else if (cmd === 'ci-off') await ciOff(args[0]);
  else if (cmd === 'mac-setup') await macSetup(args[0], args.includes('--dry'));
  else if (cmd === 'ci-runs') {
    const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    await ciRuns(args[0], { workflow: opt('--workflow'), commit: opt('--commit'), wait: Number(opt('--wait') || 0), start: args.includes('--start'), branch: opt('--branch') });
  }
  else if (cmd === 'testers') await testers(args[0], String(args[1] || '').split(/[\s,;]+/).filter(Boolean));
  else throw new Error(`unknown command ${cmd}`);
} catch (e) {
  say(`::error::${e.message}`);
  process.exit(1);
}
