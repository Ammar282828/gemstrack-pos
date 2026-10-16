// Writes App/Resources/businesses.json: the two built-in businesses of the one iPhone app, in the shape the ERP
// describes itself with (GET /api/app/business, src/app/api/app/business/route.ts). Identity (address, Google
// client, Firebase) comes from houses.json; the palettes are the colour sets' (App/Resources/Assets.xcassets,
// and lib/store-config.ts STORE_PALETTE / apphosting.mina.yaml); the rest is each house's variables.
//
//   node scripts/businesses.mjs
//
// `storeName` is the one field the server does not send: the built-ins keep the "… ERP" names they always had.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const houses = JSON.parse(fs.readFileSync(path.join(dir, 'houses.json'), 'utf8'));

const palettes = {
  taheri: {
    light: { accent: '#8A6B42', ground: '#F2F3F6', card: '#FFFFFF', onAccent: '#FFFFFF' },
    dark: { accent: '#BE9F76', ground: '#0A1111', card: '#141A1A', onAccent: '#0B1414' },
  },
  mina: {
    light: { accent: '#380000', ground: '#F4EFE8', card: '#FFFDF9', onAccent: '#FBF9F9' },
    dark: { accent: '#E8A5AE', ground: '#1C1114', card: '#27191D', onAccent: '#251318' },
  },
};
const own = {
  taheri: {
    name: 'TAHERI', margin: { kind: 'rattiLess', ratti: 6 },
    logo: { light: '/taheri-logo.png', dark: '/taheri-logo-light.png', aspect: 1528 / 383 },
    flags: { partnership: false, websiteSelling: true, invoiceByCustomer: true, invoiceWhatsappPdf: true, sizeToProfile: true },
  },
  mina: {
    name: 'MINA', margin: { kind: 'percent', percent: 40 },
    logo: { light: '/house-of-mina-logo.png', dark: '/house-of-mina-logo-light.png', aspect: 4.9458 },
    flags: { partnership: true, websiteSelling: false, invoiceByCustomer: false, invoiceWhatsappPdf: false, sizeToProfile: false },
  },
};

const out = Object.entries(houses).map(([id, h]) => ({
  version: 1,
  id,
  name: own[id].name,
  shortName: h.homeName,
  storeName: h.storeName,
  serverURL: h.url,
  metal: h.metal,
  margin: own[id].margin,
  palette: palettes[id],
  logo: { light: h.url + own[id].logo.light, dark: h.url + own[id].logo.dark, aspect: own[id].logo.aspect },
  icon: `${h.url}/icons/${id}/icon-512.png`,
  ios: {
    googleClientId: h.googleClientId,
    firebase: { apiKey: h.firebase.apiKey, appId: h.firebase.iosAppId, projectId: h.firebase.projectId, senderId: h.firebase.senderId, storageBucket: h.firebase.storageBucket },
  },
  flags: own[id].flags,
}));

const file = path.join(dir, 'App/Resources/businesses.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${file} (${out.map((b) => b.id).join(', ')})`);
