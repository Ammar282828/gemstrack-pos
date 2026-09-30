"use client";

// Settings → Alerts: the WhatsApp alerts and reports (it was the Settings page's "Alerts" tab).
import { PageShell } from '@/components/shared/page-shell';
import { NotificationsCard } from '@/components/settings/settings-sections';

export default function AlertsSettingsPage() {
  return (
    <PageShell subtitle="Who gets WhatsApp alerts, and which reports go out when.">
      <NotificationsCard />
    </PageShell>
  );
}
