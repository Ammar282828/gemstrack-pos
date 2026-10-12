"use client";

/**
 * Settings → Data: backups, what was removed, the imports, drafts, and restoring the shop's
 * defaults. Backups, Recently removed and the import pages light this tab (lib/nav.ts).
 */
import { Users, Import, Database, ArchiveRestore, RotateCcw } from 'lucide-react';
import { PageShell } from '@/components/shared/page-shell';
import { DraftsRow, RestoreDefaults, SettingsLink } from '@/components/settings/settings-sections';
import { LedgerSection } from '@/components/ledger';
import { STORE_BRAND } from '@/lib/store-config';

export default function DataSettingsPage() {
  return (
    <PageShell subtitle="Copies out, records in, and what was removed." className="space-y-[22px]">
      <LedgerSection title="Keep and restore">
        <SettingsLink href="/settings/backups" icon={ArchiveRestore} title="Backups" description="Snapshot and restore the shop's data." />
        <SettingsLink href="/settings/recently-removed" icon={RotateCcw} title="Recently removed" description="Customers and karigars you hid. Nothing is destroyed until you empty it." />
      </LedgerSection>
      <LedgerSection title="Imports" footer="Bring records in from a phone or another app.">
        <SettingsLink href="/settings/contact-import" icon={Users} title="Import contacts" description="From a phone's address book, marked TJ, HOM, TC or Karigar." />
        <SettingsLink href="/settings/hisaab-import" icon={Import} title="Import hisaab" description="Historical ledgers from other apps." />
        {/* Taheri's previous app's book: Taheri only. */}
        {STORE_BRAND === 'taheri' && (
          <SettingsLink href="/settings/import-taheri" icon={Database} title="Import Taheri Software book" description="One-off: 377 customers and 46 karigars from the shop's previous app." />
        )}
      </LedgerSection>
      <DraftsRow />
      <RestoreDefaults />
    </PageShell>
  );
}
