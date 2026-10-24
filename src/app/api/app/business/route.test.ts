import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const MINA = {
  NEXT_PUBLIC_STORE_BRAND: 'mina', NEXT_PUBLIC_STORE_NAME: 'House of Mina', NEXT_PUBLIC_STORE_DEFAULT_METAL: 'silver',
  NEXT_PUBLIC_STORE_COST_RATTI_LESS: 'none', NEXT_PUBLIC_STORE_EST_MARGIN: '0.40', NEXT_PUBLIC_STORE_PARTNERSHIP: '1',
  NEXT_PUBLIC_STORE_INVOICE_BY_CUSTOMER: '0', NEXT_PUBLIC_STORE_WORKSHOP_START: 'anyone',
  NEXT_PUBLIC_STORE_LOGO_URL: '/house-of-mina-logo.png', NEXT_PUBLIC_STORE_LOGO_LIGHT_URL: '/house-of-mina-logo-light.png',
  NEXT_PUBLIC_STORE_LOGO_ASPECT: '4.9458',
  NEXT_PUBLIC_STORE_PALETTE: '{"light":{"accent":"#380000","ground":"#F4EFE8","card":"#FFFDF9","onAccent":"#FBF9F9"},"dark":{"accent":"#E8A5AE","ground":"#1C1114","card":"#27191D","onAccent":"#251318"}}',
  APP_ANDROID_FIREBASE_APP_ID: 'none', APP_ANDROID_GOOGLE_WEB_CLIENT_ID: 'none',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'mina-web-key',
  APP_IOS_GOOGLE_CLIENT_ID: 'mina-client', APP_IOS_FIREBASE_API_KEY: 'mina-key', APP_IOS_FIREBASE_APP_ID: '1:2:ios:3',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'hom-pos', NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '288366939838',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'hom-pos.firebasestorage.app',
};
const KEYS = [...Object.keys(MINA), 'APP_ANDROID_FIREBASE_APP_ID', 'APP_ANDROID_GOOGLE_WEB_CLIENT_ID'];

async function get(env: Record<string, string> = {}, host = 'erp.taheri.shop') {
  vi.resetModules();
  for (const k of KEYS) vi.stubEnv(k, undefined);
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { GET } = await import('./route');
  const res = await GET(new NextRequest('http://internal:8080/api/app/business', { headers: { 'x-forwarded-host': host } }));
  return { res, body: await res.json() };
}
afterEach(() => vi.unstubAllEnvs());

describe('/api/app/business', () => {
  it('answers Taheri by default, publicly and cacheable', async () => {
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(body).toMatchObject({
      version: 1, id: 'taheri', name: 'TAHERI', shortName: 'Taheri ERP', serverURL: 'https://erp.taheri.shop', metal: 'gold',
      margin: { kind: 'rattiLess', ratti: 6 },
      palette: {
        light: { accent: '#8A6B42', ground: '#F2F3F6', card: '#FFFFFF', onAccent: '#FFFFFF' },
        dark: { accent: '#BE9F76', ground: '#0A1111', card: '#141A1A', onAccent: '#0B1414' },
      },
      logo: { light: 'https://erp.taheri.shop/taheri-logo.png', dark: 'https://erp.taheri.shop/taheri-logo-light.png' },
      icon: 'https://erp.taheri.shop/icons/taheri/icon-512.png',
      ios: {
        googleClientId: '948018742883-9jb931ki5kuhckfo4c6400k1mh5ucpg0.apps.googleusercontent.com',
        firebase: { apiKey: 'AIzaSyAl3W_9_Z9j0sR7rGIwwM1uiiXvOxGQ7IA', appId: '1:948018742883:ios:2288410141abf27f089a56', projectId: 'gemstrack-pos', senderId: '948018742883', storageBucket: 'gemstrack-pos.firebasestorage.app' },
      },
      flags: { partnership: false, websiteSelling: true, invoiceByCustomer: true, invoiceWhatsappPdf: true, sizeToProfile: true, workshopStart: 'you' },
    });
    expect(body.logo.aspect).toBeCloseTo(1528 / 383);
    expect(body.nav).toBeUndefined();
  });

  it('answers Mina from its variables', async () => {
    const { body } = await get(MINA, 'erp.houseofmina.store');
    expect(body).toMatchObject({
      id: 'mina', name: 'House of Mina', shortName: 'Mina ERP', serverURL: 'https://erp.houseofmina.store', metal: 'silver',
      margin: { kind: 'percent', percent: 40 },
      palette: {
        light: { accent: '#380000', ground: '#F4EFE8', card: '#FFFDF9', onAccent: '#FBF9F9' },
        dark: { accent: '#E8A5AE', ground: '#1C1114', card: '#27191D', onAccent: '#251318' },
      },
      logo: { light: 'https://erp.houseofmina.store/house-of-mina-logo.png', dark: 'https://erp.houseofmina.store/house-of-mina-logo-light.png', aspect: 4.9458 },
      icon: 'https://erp.houseofmina.store/icons/mina/icon-512.png',
      ios: { googleClientId: 'mina-client', firebase: { apiKey: 'mina-key', appId: '1:2:ios:3', projectId: 'hom-pos', senderId: '288366939838', storageBucket: 'hom-pos.firebasestorage.app' } },
      flags: { partnership: true, invoiceByCustomer: false, workshopStart: 'anyone' },
    });
  });

  it('says which Android app signs in: Taheri\'s by default, from the variables otherwise', async () => {
    const { body } = await get();
    expect(body.android).toEqual({
      googleWebClientId: '948018742883-q27leh2et2p8948jadblbg6skpdhjcea.apps.googleusercontent.com',
      firebase: { appId: '1:948018742883:android:e42554c3a7f534a6089a56', apiKey: 'AIzaSyAl3W_9_Z9j0sR7rGIwwM1uiiXvOxGQ7IA', projectId: 'gemstrack-pos', senderId: '948018742883', storageBucket: 'gemstrack-pos.firebasestorage.app' },
    });
    const own = await get({ APP_ANDROID_FIREBASE_APP_ID: '1:2:android:3', APP_ANDROID_GOOGLE_WEB_CLIENT_ID: 'web-client.apps.googleusercontent.com', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'hom-pos', NEXT_PUBLIC_FIREBASE_API_KEY: 'hom-key' });
    expect(own.body.android).toEqual({
      googleWebClientId: 'web-client.apps.googleusercontent.com',
      firebase: { appId: '1:2:android:3', apiKey: 'hom-key', projectId: 'hom-pos', senderId: '948018742883', storageBucket: 'gemstrack-pos.firebasestorage.app' },
    });
  });

  it('answers android: null for a house that has not registered the app (none, 0, off or empty), never Taheri\'s', async () => {
    expect((await get(MINA, 'erp.houseofmina.store')).body.android).toBeNull();
    for (const off of ['none', 'NONE', '0', 'off', '']) {
      expect((await get({ APP_ANDROID_FIREBASE_APP_ID: off })).body.android).toBeNull();
      expect((await get({ APP_ANDROID_GOOGLE_WEB_CLIENT_ID: off })).body.android).toBeNull();
    }
    // The iOS block is untouched by it.
    expect((await get(MINA, 'erp.houseofmina.store')).body.ios.firebase.appId).toBe('1:2:ios:3');
  });

  it('falls back to Taheri\'s colours for a malformed palette', async () => {
    const { body } = await get({ NEXT_PUBLIC_STORE_PALETTE: '{"light":{"accent":"red"}' });
    expect(body.palette.light.accent).toBe('#8A6B42');
  });

  it('agrees with /api/app/me on the flags', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_STORE_PARTNERSHIP', '1');
    const { shopFlags } = await import('@/lib/app-shop');
    const { GET } = await import('./route');
    const body = await (await GET(new NextRequest('https://x.test/api/app/business'))).json();
    expect(body.flags).toEqual(shopFlags());
  });
});

describe('push devices of the merged app', () => {
  it('accepts shop.taheri.erp on either house', async () => {
    vi.doMock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async () => null }));
    const { isBundleId } = await import('@/lib/push/gate');
    expect(isBundleId('shop.taheri.erp')).toBe(true);
    expect(isBundleId('store.houseofmina.erp')).toBe(true);
    expect(isBundleId('nope')).toBe(false);
  });
});
