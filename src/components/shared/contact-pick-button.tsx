"use client";

/**
 * "Choose from contacts" beside a phone box. Owner, 2026-11-03: "when adding numbers for any customers or karigars
 * let me choose from contacts". The browser's Contact Picker API exists only in Chrome on Android; everywhere else the
 * button renders nothing, so the box is typed as before.
 */

import React from 'react';
import { BookUser } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type ContactPick = { name: string; phone: string };

type ContactsManager = {
  select: (properties: string[], options?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
};

function contactsApi(): ContactsManager | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  if (!('contacts' in navigator) || !('ContactsManager' in window)) return null;
  return (navigator as unknown as { contacts: ContactsManager }).contacts;
}

export const ContactPickButton: React.FC<{
  onPick: (pick: ContactPick) => void;
  disabled?: boolean;
}> = ({ onPick, disabled }) => {
  // Decided after mount, so the server and the first client render agree.
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => { setSupported(contactsApi() !== null); }, []);
  if (!supported) return null;

  const choose = async () => {
    const api = contactsApi();
    if (!api) return;
    try {
      const [picked] = await api.select(['name', 'tel'], { multiple: false });
      if (!picked) return;
      const phone = (picked.tel || []).map(t => String(t).trim()).find(Boolean) || '';
      const name = (picked.name || []).map(n => String(n).trim()).find(Boolean) || '';
      if (phone || name) onPick({ name, phone });
    } catch {
      // Cancelled, or the picker needs a tap that did not count: the box stays as it was.
    }
  };

  return (
    <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" disabled={disabled}
      onClick={choose} aria-label="From contacts" title="From contacts">
      <BookUser className="h-5 w-5" />
    </Button>
  );
};
