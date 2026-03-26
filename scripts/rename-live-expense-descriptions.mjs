#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import authMod from '/opt/homebrew/lib/node_modules/firebase-tools/lib/auth.js';
import * as scopes from '/opt/homebrew/lib/node_modules/firebase-tools/lib/scopes.js';
import { normalizeExpenseDescription } from './lib/expense-description-normalizer.mjs';

const PROJECT_ID = 'hom-pos-52710474-ceeea';
const COLLECTION = 'expenses';

function usage() {
  console.log('Usage: node scripts/rename-live-expense-descriptions.mjs [--dry-run] [--backup <backup.json>]');
  console.log('Reads live Firestore expenses using Firebase CLI auth, backs them up, and rewrites only description fields.');
}

function parseArgs(argv) {
  let dryRun = false;
  let backupPath = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--backup') {
      backupPath = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  return { dryRun, backupPath };
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString();
}

function toFirestoreString(value) {
  return { stringValue: String(value ?? '') };
}

function getNumericField(field) {
  if (!field) return 0;
  if (field.integerValue !== undefined) return Number(field.integerValue);
  if (field.doubleValue !== undefined) return Number(field.doubleValue);
  return 0;
}

function docToExpense(doc) {
  const fields = doc.fields || {};
  return {
    id: doc.name.split('/').pop(),
    name: doc.name,
    date: fields.date?.timestampValue || fields.date?.stringValue || '',
    category: fields.category?.stringValue || '',
    description: fields.description?.stringValue || '',
    amount: getNumericField(fields.amount),
    fields,
  };
}

function backupPayload(expenses) {
  return {
    exportedAt: new Date().toISOString(),
    collections: [COLLECTION],
    data: {
      [COLLECTION]: Object.fromEntries(
        expenses.map(expense => [expense.id, {
          ...Object.fromEntries(Object.entries(expense.fields).map(([key, value]) => {
            if (value.stringValue !== undefined) return [key, value.stringValue];
            if (value.integerValue !== undefined) return [key, Number(value.integerValue)];
            if (value.doubleValue !== undefined) return [key, Number(value.doubleValue)];
            if (value.timestampValue !== undefined) return [key, value.timestampValue];
            if (value.booleanValue !== undefined) return [key, Boolean(value.booleanValue)];
            return [key, value];
          })),
        }])
      ),
    },
  };
}

function defaultBackupPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(os.tmpdir(), `expenses-backup-before-description-rename-${stamp}.json`);
}

async function getGoogleAccessToken() {
  const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const refreshToken = cfg.tokens?.refresh_token;
  if (!refreshToken) throw new Error('No Firebase CLI refresh token found. Run firebase login first.');
  const tokenData = await authMod.getAccessToken(refreshToken, [scopes.CLOUD_PLATFORM]);
  if (!tokenData?.access_token) throw new Error('Could not mint Google access token from Firebase CLI session.');
  return tokenData.access_token;
}

async function listExpenses(accessToken) {
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}?pageSize=300`;
  const docs = [];

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to list expenses: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    docs.push(...(body.documents || []));
    url = body.nextPageToken
      ? `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}?pageSize=300&pageToken=${encodeURIComponent(body.nextPageToken)}`
      : null;
  }

  return docs.map(docToExpense);
}

async function patchDescription(accessToken, expenseId, description) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}/${encodeURIComponent(expenseId)}?updateMask.fieldPaths=description`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        description: toFirestoreString(description),
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update ${expenseId}: ${res.status} ${await res.text()}`);
  }
}

try {
  const { dryRun, backupPath } = parseArgs(process.argv.slice(2));
  const accessToken = await getGoogleAccessToken();
  const before = await listExpenses(accessToken);
  const backupFile = path.resolve(process.cwd(), backupPath || defaultBackupPath());

  fs.writeFileSync(backupFile, `${JSON.stringify(backupPayload(before), null, 2)}\n`);

  const changes = before
    .map(expense => ({
      ...expense,
      nextDescription: normalizeExpenseDescription(expense),
    }))
    .filter(expense => expense.nextDescription !== expense.description);

  const totalBefore = before.reduce((sum, expense) => sum + expense.amount, 0);

  console.log(`Expenses scanned: ${before.length}`);
  console.log(`Descriptions to change: ${changes.length}`);
  console.log(`Backup written: ${backupFile}`);
  console.log(`Total amount before: PKR ${formatAmount(totalBefore)}`);

  if (changes.length > 0) {
    console.log('\nPreview of changes:');
    changes.slice(0, 25).forEach(change => {
      console.log(`- [${String(change.date).slice(0, 10)}] ${change.description} -> ${change.nextDescription} (PKR ${formatAmount(change.amount)})`);
    });
    if (changes.length > 25) {
      console.log(`...and ${changes.length - 25} more`);
    }
  }

  if (dryRun) {
    console.log('\nDry run only. No Firestore writes performed.');
    process.exit(0);
  }

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    await patchDescription(accessToken, change.id, change.nextDescription);
    if ((i + 1) % 25 === 0 || i === changes.length - 1) {
      console.log(`Updated ${i + 1}/${changes.length}`);
    }
  }

  const after = await listExpenses(accessToken);
  const totalAfter = after.reduce((sum, expense) => sum + expense.amount, 0);

  console.log('\nVerification:');
  console.log(`Entries preserved: ${before.length === after.length ? 'yes' : 'no'}`);
  console.log(`Total amount preserved: ${totalBefore === totalAfter ? `yes (PKR ${formatAmount(totalAfter)})` : 'no'}`);
  console.log(`Descriptions changed live: ${after.filter(expense => normalizeExpenseDescription(expense) === expense.description).length}/${after.length} normalized`);
} catch (error) {
  console.error(error.message || error);
  usage();
  process.exit(1);
}
