import { describe, expect, it } from 'vitest';
import { diagnose } from './diagnose';

const ctx = { site: 'taheri.shop', aiProject: 'jewelgen-mm-e3d43ecb', posProject: 'gemstrack-pos', metaAppId: '1075984878628188', waLine: '+923262275554', igUsername: 'collectionstaheri' };

describe('diagnose — the errors actually seen on 2026-09-24', () => {
  it('points a redirect_uri complaint at the app secret', () => {
    const d = diagnose('instagram-connect', 'Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request', ctx);
    expect(d.title).toMatch(/app secret/i);
    expect(d.fix).toMatch(/Instagram app secret/);
    expect(d.action?.href).toContain('instagram-app-secret');
  });
  it('reads the "only photo or video" refusal as Instagram failing to fetch the image', () => {
    expect(diagnose('instagram', 'Only photo or video can be accepted as media type.', ctx).title).toBe('Instagram couldn’t fetch the image');
  });
  it('says a spent code means connect again', () => {
    expect(diagnose('instagram-connect', 'This authorization code has been used', ctx).fix).toMatch(/Connect Instagram again/);
  });
  it('turns a Vertex permission error into the grant command', () => {
    const d = diagnose('ai', { status: 403, message: "Permission 'aiplatform.endpoints.predict' denied on resource" }, ctx);
    expect(d.action?.command).toBe('gcloud projects add-iam-policy-binding jewelgen-mm-e3d43ecb --member=serviceAccount:firebase-app-hosting-compute@gemstrack-pos.iam.gserviceaccount.com --role=roles/aiplatform.user');
  });
  it('recognises a retired model name', () => {
    expect(diagnose('ai', { status: 404, message: 'Publisher model `…gemini-3-pro-image-preview` was not found or your project does not have access to it' }, ctx).title).toMatch(/renamed or retired/);
  });
});

describe('diagnose — WhatsApp', () => {
  it('a signed-out line means scan the QR, with the console link', () => {
    const d = diagnose('whatsapp', 'Instance is "notAuthorized" — rescan the QR', ctx);
    expect(d.fix).toMatch(/scan the QR/);
    expect(d.action?.href).toContain('green-api');
  });
  it('a plan limit says upgrade', () => {
    expect(diagnose('whatsapp', { status: 466, message: 'Exceeding limitation on plan' }, ctx).fix).toMatch(/Upgrade/);
  });
  it('names the number when it is not an admin', () => {
    expect(diagnose('whatsapp', 'not admin', ctx).fix).toContain('+923262275554');
  });
});

describe('diagnose — website', () => {
  it('a 401 is the upload key', () => {
    expect(diagnose('website', { status: 502, message: 'Unauthorized.' }, ctx).title).toMatch(/upload key/);
  });
  it('a timeout warns about duplicates before retrying', () => {
    const d = diagnose('website', { status: 504, message: 'The website did not answer in time.' }, ctx);
    expect(d.fix).toMatch(/duplicate/);
    expect(d.retry).toBe(true);
  });
});

describe('diagnose — anything', () => {
  it('a dropped connection is about the device, not the service', () => {
    expect(diagnose('instagram', 'TypeError: Failed to fetch', ctx).title).toBe('No internet connection');
  });
  it('the server failing to reach a service names that service', () => {
    expect(diagnose('website', 'fetch failed', ctx).title).toBe('Taheri.shop can’t be reached');
    expect(diagnose('whatsapp', 'getaddrinfo ENOTFOUND api.green-api.com', ctx).title).toBe('api.green-api.com can’t be found by name');
    expect(diagnose('whatsapp', 'read ECONNRESET', ctx).title).toMatch(/Green API/);
    expect(diagnose('ai', 'timed out', ctx).fix).toMatch(/Retry/);
  });
  it('a name that cannot be found points at DNS and the backup address', () => {
    const d = diagnose('website', 'fetch failed (ENOTFOUND taheri.shop)', ctx);
    expect(d.title).toBe('taheri.shop can’t be found by name');
    expect(d.fix).toContain('hosted.app');
  });
  it('an unknown error still says what to do next', () => {
    const d = diagnose('page', 'something odd', ctx);
    expect(d.fix).toMatch(/Retry/);
    expect(d.fix).toContain('something odd');
  });
});

describe('diagnose — WAHA, the WhatsApp gateway since 2026-09-25', () => {
  const w = { ...ctx, wahaUrl: 'https://35-184-20-165.sslip.io' };
  it('a refused key points at the secret, not at relinking', () => {
    const d = diagnose('whatsapp', { status: 502, message: 'WAHA 401: {"message":"Unauthorized","statusCode":401}' }, w);
    expect(d.title).toBe('WAHA refused the key');
    expect(d.action?.href).toContain('waha-api-key');
  });
  it('an unlinked session (the health check’s words) sends you to relink in the dashboard', () => {
    const d = diagnose('whatsapp', { message: 'notAuthorized SCAN_QR_CODE The line is not linked to WAHA — link it again (WhatsApp → Linked devices).' }, w);
    expect(d.title).toMatch(/unlinked from WAHA/);
    expect(d.action?.href).toBe('https://35-184-20-165.sslip.io/dashboard');
  });
  it('Caddy’s 502 with WAHA down points at the VM', () => {
    expect(diagnose('whatsapp', { status: 502, message: 'WAHA 502: ' }, w).title).toBe('The WAHA server isn’t answering');
  });
  it('a channel send through Green API says channels need WAHA', () => {
    expect(diagnose('whatsapp', 'Green API cannot post to a WhatsApp channel — that needs WAHA.', w).title).toBe('Channels need WAHA');
  });
});
