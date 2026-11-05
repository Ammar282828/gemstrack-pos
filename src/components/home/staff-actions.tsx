"use client";

/**
 * An employee's Home has no figures (the owner, 2026-11-05: "Dashboard should not have numbers, just tailored features
 * for her"): the things she does, one tap each, then the work lists below it. The marketing row only for an employee
 * who also runs the marketing (lib/roles.ts `alsoMarketing`), and Help always (app/help).
 */

import { PlusCircle, ClipboardList, Wrench, ScanLine, UserPlus, Hammer, ImagePlus, Palette, Camera, Megaphone, LifeBuoy } from 'lucide-react';
import { QuickAction } from '@/components/ledger';
import { STORE_META_ADS, STORE_DESIGN, STORE_SITE_POSTS } from '@/lib/store-config';

export function StaffActions({ marketing }: { marketing: boolean }) {
  const work = [
    { href: '/new', label: 'New sale', icon: <PlusCircle />, prominent: true },
    { href: '/orders/add', label: 'New order', icon: <ClipboardList /> },
    { href: '/repairs?new=1', label: 'New repair', icon: <Wrench /> },
    { href: '/scan', label: 'Scan a tag', icon: <ScanLine /> },
    { href: '/customers/add', label: 'New customer', icon: <UserPlus /> },
    { href: '/workshop', label: 'Workshop', icon: <Hammer /> },
  ];
  const marketingRow = [
    { href: '/website/photos', label: 'Add photos', icon: <ImagePlus /> },
    ...(STORE_DESIGN ? [{ href: '/design', label: 'Design', icon: <Palette /> }] : []),
    ...(STORE_SITE_POSTS ? [{ href: '/posts/stories', label: 'Stories', icon: <Camera /> }] : []),
    ...(STORE_META_ADS ? [{ href: '/ads/new', label: 'New ad', icon: <Megaphone /> }] : []),
    { href: '/help', label: 'Help', icon: <LifeBuoy /> },
  ];
  const help = { href: '/help', label: 'Help', icon: <LifeBuoy /> };
  const row = (items: { href: string; label: string; icon: React.ReactNode; prominent?: boolean }[]) => (
    <div className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6">
      {items.map(a => <QuickAction key={a.href} href={a.href} label={a.label} icon={a.icon} prominent={a.prominent} />)}
    </div>
  );
  return (
    <div className="space-y-4 rounded-card bg-card p-4">
      {row(work)}
      {marketing ? (
        <div className="space-y-2">
          <p className="text-ios-cap font-semibold uppercase tracking-[.8px] text-muted-foreground">Marketing</p>
          {row(marketingRow)}
        </div>
      ) : row([help])}
    </div>
  );
}
