import * as React from 'react';
import { MessageCircle, MessageSquare, Phone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { whatsAppLink } from '@/lib/whatsapp';

export interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  prominent?: boolean;
  href: string;
  className?: string;
}

/** A 44px-high tile with the word beneath. */
export function QuickAction({ icon, label, prominent, href, className }: QuickActionProps) {
  const external = /^https?:/.test(href);
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cn('group flex min-w-0 flex-1 flex-col items-center gap-1 focus-visible:outline-none', className)}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-11 w-full items-center justify-center rounded-tile transition-opacity group-active:opacity-70 group-focus-visible:ring-2 group-focus-visible:ring-primary/40 [&>svg]:h-5 [&>svg]:w-5',
          prominent ? 'bg-primary text-primary-foreground' : 'bg-primary/[.12] text-primary',
        )}
      >
        {icon}
      </span>
      <span className="text-2xs font-medium text-foreground">{label}</span>
    </a>
  );
}

/** Hrefs for a phone number; null when there is no usable number. */
export function contactHrefs(phone: string | null | undefined) {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '');
  const wa = whatsAppLink(phone);
  if (!digits || !wa) return null;
  return { tel: `tel:${digits}`, whatsapp: wa, sms: `sms:${digits}` };
}

/** Call / WhatsApp / Message. Renders nothing without a number. */
export function ContactActions({ phone, className }: { phone: string | null | undefined; className?: string }) {
  const h = contactHrefs(phone);
  if (!h) return null;
  return (
    <div className={cn('flex gap-3', className)}>
      <QuickAction icon={<Phone />} label="Call" href={h.tel} prominent />
      <QuickAction icon={<MessageCircle />} label="WhatsApp" href={h.whatsapp} />
      <QuickAction icon={<MessageSquare />} label="Message" href={h.sms} />
    </div>
  );
}
