/**
 * Settings → Backups: what "Download Backup" copies out, and the file it makes (src/app/settings/backups).
 * The one list, for the page (its EXPORTABLE_COLLECTIONS) and for the iPhone app, whose backup is read
 * through /api/app/backup a collection at a time and put together on the phone in the page's own format:
 * `{ exportedAt, collections, data: { <collection>: { <id>: document } } }`, which the page's Restore reads.
 */

export type BackupCollection = { id: string; label: string; description: string };

export const BACKUP_COLLECTIONS: readonly BackupCollection[] = [
  { id: 'products', label: 'Stock', description: 'Pieces in stock' },
  { id: 'customers', label: 'Customers', description: 'Customer contact details' },
  { id: 'karigars', label: 'Karigars', description: 'Artisan/supplier records' },
  { id: 'orders', label: 'Orders', description: 'Custom order records' },
  { id: 'invoices', label: 'Invoices', description: 'Generated sale invoices' },
  { id: 'hisaab', label: 'Hisaab', description: 'Outstanding balances' },
  { id: 'expenses', label: 'Expenses', description: 'Expense records' },
  { id: 'additional_revenue', label: 'Extra revenue', description: 'Income not tied to a sale' },
  { id: 'karigar_batches', label: 'Karigar Batches', description: 'Karigar work batches' },
  { id: 'given_items', label: 'Given Items', description: 'Items given out' },
  { id: 'repairs', label: 'Repairs', description: "Customers' pieces in for repair" },
  { id: 'categories', label: 'Categories', description: 'Product category definitions' },
  { id: 'sold_products', label: 'Sold pieces', description: 'Every piece sold, kept for the record' },
];

export const isBackupCollection = (id: unknown): id is string =>
  typeof id === 'string' && BACKUP_COLLECTIONS.some((c) => c.id === id);

/**
 * "Taheri-Gold-backup-2026-10-09-1430.json": the shop's name with its spaces as dashes, and the minute in
 * Karachi (the page's date-fns `yyyy-MM-dd-HHmm`, read off a shop device; the server's clock is UTC).
 */
export function backupFileName(shopName: string | undefined, now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const stamp = `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`;
  return `${(shopName || 'gemstrack').replace(/\s+/g, '-')}-backup-${stamp}.json`;
}

/**
 * A document as the browser's JSON.stringify writes it: Firestore's Timestamp as `{ seconds, nanoseconds }`
 * (the client SDK's toJSON; the Admin SDK's has none and would write `_seconds`), a reference as its path.
 */
export function backupReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as { toDate?: unknown; seconds?: unknown; nanoseconds?: unknown; path?: unknown; firestore?: unknown };
    if (typeof v.toDate === 'function' && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number') {
      return { seconds: v.seconds, nanoseconds: v.nanoseconds };
    }
    if (typeof v.path === 'string' && v.firestore) return v.path;
  }
  return value;
}
