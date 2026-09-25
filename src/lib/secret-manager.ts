/**
 * Secret Manager by REST, for values this app writes at runtime (connection
 * tokens) or reads without declaring them in apphosting.yaml.
 *
 * A secret declared in apphosting.yaml must exist before the rollout, or the
 * rollout fails; a secret read through here only has to exist when it is used,
 * and its absence is an answer ("not set up yet") rather than a failed deploy.
 * Each secret needs secretAccessor (and secretVersionAdder, where the app
 * writes it) for this project's App Hosting account.
 *
 * Server-only. Never logs a value.
 */

import { GoogleAuth } from 'google-auth-library';

const PROJECT = () => process.env.GOOGLE_CLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
const gauth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

export class SecretError extends Error {
  constructor(message: string, public status = 503) { super(message); this.name = 'SecretError'; }
}

async function sm(name: string, path: string, init?: RequestInit): Promise<Response> {
  const token = (await (await gauth.getClient()).getAccessToken()).token;
  return fetch(`https://secretmanager.googleapis.com/v1/projects/${PROJECT()}/secrets/${name}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });
}

/** The latest version's text, or null when the secret or any version of it doesn't exist yet. */
export async function readSecret(name: string): Promise<string | null> {
  const res = await sm(name, '/versions/latest:access');
  // 404: no such secret. 400 / FAILED_PRECONDITION: a secret with no enabled version.
  if (res.status === 404 || res.status === 400) return null;
  if (res.status === 403) throw new SecretError(`This server may not read the secret "${name}" (needs Secret Manager Secret Accessor).`, 503);
  if (!res.ok) throw new SecretError(`Could not read the secret "${name}" (${res.status}).`, 503);
  const d = await res.json();
  const text = Buffer.from(String(d?.payload?.data ?? ''), 'base64').toString('utf8');
  return text.trim() ? text : null;
}

/** Store a new version (the previous ones stay, disabled by nothing — Secret Manager keeps history). */
export async function addSecretVersion(name: string, value: string): Promise<void> {
  const res = await sm(name, ':addVersion', { method: 'POST', body: JSON.stringify({ payload: { data: Buffer.from(value).toString('base64') } }) });
  if (res.status === 404) throw new SecretError(`The secret "${name}" doesn't exist in this project yet.`, 503);
  if (res.status === 403) throw new SecretError(`This server may not save to the secret "${name}" (needs Secret Manager Secret Version Adder).`, 503);
  if (!res.ok) throw new SecretError(`Could not save the secret "${name}" (${res.status}: ${(await res.text()).slice(0, 160)}).`, 503);
}

/** Can this deployment read, and add versions to, the secret? */
export async function secretAccess(name: string): Promise<{ exists: boolean; read: boolean; write: boolean }> {
  const res = await sm(name, ':testIamPermissions', { method: 'POST', body: JSON.stringify({ permissions: ['secretmanager.versions.access', 'secretmanager.versions.add'] }) });
  if (res.status === 404) return { exists: false, read: false, write: false };
  if (!res.ok) return { exists: true, read: false, write: false };
  const granted: string[] = (await res.json()).permissions ?? [];
  return { exists: true, read: granted.includes('secretmanager.versions.access'), write: granted.includes('secretmanager.versions.add') };
}

export const secretConsoleUrl = (name: string) =>
  `https://console.cloud.google.com/security/secret-manager/secret/${name}/versions?project=${PROJECT()}`;
export const posProject = PROJECT;
