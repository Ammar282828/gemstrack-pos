#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { normalizeExpenseDescription } from './lib/expense-description-normalizer.mjs';

function usage() {
  console.log('Usage: node scripts/normalize-expense-descriptions.mjs <backup.json> [--in-place] [--out <output.json>]');
  console.log('Rewrites only expense descriptions inside an exported backup JSON.');
}

function parseArgs(argv) {
  const args = [...argv];
  let inputPath = null;
  let outputPath = null;
  let inPlace = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--in-place') {
      inPlace = true;
      continue;
    }
    if (arg === '--out') {
      outputPath = args[i + 1];
      i += 1;
      continue;
    }
    if (!inputPath) {
      inputPath = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }

  if (!inputPath) throw new Error('Missing input JSON file path.');
  if (inPlace && outputPath) throw new Error('Use either --in-place or --out, not both.');

  return { inputPath, outputPath, inPlace };
}

function loadBackup(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function resolveExpensesContainer(payload) {
  if (payload?.data?.expenses && typeof payload.data.expenses === 'object' && !Array.isArray(payload.data.expenses)) {
    return { expenses: payload.data.expenses, writeBack(nextExpenses) { payload.data.expenses = nextExpenses; return payload; } };
  }

  if (payload?.expenses && typeof payload.expenses === 'object' && !Array.isArray(payload.expenses)) {
    return { expenses: payload.expenses, writeBack(nextExpenses) { payload.expenses = nextExpenses; return payload; } };
  }

  throw new Error('Could not find expenses in this JSON. Expected backup.data.expenses or expenses.');
}

function defaultOutputPath(inputPath) {
  const ext = path.extname(inputPath) || '.json';
  const base = inputPath.slice(0, inputPath.length - ext.length);
  return `${base}.normalized${ext}`;
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString();
}

try {
  const { inputPath, outputPath, inPlace } = parseArgs(process.argv.slice(2));
  const resolvedInputPath = path.resolve(process.cwd(), inputPath);
  const payload = loadBackup(resolvedInputPath);
  const { expenses, writeBack } = resolveExpensesContainer(payload);

  const nextExpenses = {};
  const changes = [];
  const ids = Object.keys(expenses);
  let totalBefore = 0;
  let totalAfter = 0;

  for (const id of ids) {
    const current = expenses[id] || {};
    const amount = Number(current.amount || 0);
    const nextDescription = normalizeExpenseDescription(current);

    totalBefore += amount;
    totalAfter += amount;
    nextExpenses[id] = { ...current, description: nextDescription };

    if (nextDescription !== current.description) {
      changes.push({
        id,
        date: current.date || '',
        amount,
        from: current.description,
        to: nextDescription,
      });
    }
  }

  const nextPayload = writeBack(nextExpenses);
  const destination = inPlace ? resolvedInputPath : path.resolve(process.cwd(), outputPath || defaultOutputPath(resolvedInputPath));

  fs.writeFileSync(destination, `${JSON.stringify(nextPayload, null, 2)}\n`);

  console.log(`Expenses scanned: ${ids.length}`);
  console.log(`Descriptions changed: ${changes.length}`);
  console.log(`Entries preserved: ${ids.length === Object.keys(nextExpenses).length ? 'yes' : 'no'}`);
  console.log(`Total amount preserved: ${totalBefore === totalAfter ? `yes (PKR ${formatAmount(totalBefore)})` : 'no'}`);
  console.log(`Output: ${destination}`);

  if (changes.length > 0) {
    console.log('\nPreview of changes:');
    changes.slice(0, 25).forEach(change => {
      const date = String(change.date).slice(0, 10) || 'unknown-date';
      console.log(`- [${date}] ${change.from} -> ${change.to} (PKR ${formatAmount(change.amount)})`);
    });
    if (changes.length > 25) {
      console.log(`...and ${changes.length - 25} more`);
    }
  }
} catch (error) {
  console.error(error.message || error);
  usage();
  process.exit(1);
}
