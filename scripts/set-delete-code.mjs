#!/usr/bin/env node
/**
 * Set or change a house's delete code (lib/delete-code-server.ts):
 *
 *   node scripts/set-delete-code.mjs <project-id> <code>
 *
 * Writes a salted hash to `app_private/delete_code`; the code itself is stored nowhere and never
 * printed. Google credentials from the machine (applicationDefault). Four to eight digits.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';

const [project, code] = process.argv.slice(2);
if (!project || !/^\d{4,8}$/.test(code || '')) {
  console.error('usage: node scripts/set-delete-code.mjs <project-id> <4–8 digit code>');
  process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId: project });
const salt = randomBytes(16).toString('hex');
// The same hash as hashDeleteCode() in src/lib/delete-code-server.ts.
const hash = createHash('sha256').update(`erp-delete-code:${salt}:${code}`).digest('hex');
await getFirestore().collection('app_private').doc('delete_code').set({ salt, hash, setAt: new Date().toISOString(), setBy: 'scripts/set-delete-code.mjs' });
console.log(`${project}: delete code set (${code.length} digits).`);
