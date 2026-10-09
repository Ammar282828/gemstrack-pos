import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKUP_COLLECTIONS, backupFileName, backupReplacer, isBackupCollection } from './backup-collections';

describe('BACKUP_COLLECTIONS', () => {
  it('is the page\'s own list, until the page imports it from here', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../app/settings/backups/page.tsx'), 'utf8');
    const listed = [...page.matchAll(/\{ id: '([a-z_]+)',\s+label: '([^']+)',\s+description: (?:'([^']+)'|"([^"]+)") \}/g)]
      .map((m) => ({ id: m[1], label: m[2], description: m[3] ?? m[4] }));
    expect(listed).toEqual(BACKUP_COLLECTIONS);
  });

  it('names only those collections', () => {
    expect(isBackupCollection('hisaab')).toBe(true);
    expect(isBackupCollection('app_settings')).toBe(false);
    expect(isBackupCollection('app_private')).toBe(false);
    expect(isBackupCollection(undefined)).toBe(false);
  });
});

describe('backupFileName', () => {
  it('is the shop\'s name with dashes and the minute in Karachi', () => {
    expect(backupFileName('Demo Gold House', new Date('2026-10-09T21:05:00.000Z'))).toBe('Demo-Gold-House-backup-2026-10-10-0205.json');
    expect(backupFileName('', new Date('2026-01-02T03:04:00.000Z'))).toBe('gemstrack-backup-2026-01-02-0804.json');
  });
});

describe('backupReplacer', () => {
  it('writes a Timestamp as the browser does and leaves the rest', () => {
    const ts = { seconds: 1700000000, nanoseconds: 5, toDate: () => new Date(0) };
    expect(JSON.parse(JSON.stringify({ at: ts, n: 1, s: 'x', list: [ts] }, backupReplacer)))
      .toEqual({ at: { seconds: 1700000000, nanoseconds: 5 }, n: 1, s: 'x', list: [{ seconds: 1700000000, nanoseconds: 5 }] });
    expect(JSON.parse(JSON.stringify({ ref: { path: 'customers/c1', firestore: {} } }, backupReplacer))).toEqual({ ref: 'customers/c1' });
  });
});
