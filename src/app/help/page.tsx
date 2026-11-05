"use client";

/**
 * Help: how to do each thing an employee can do, in a few plain steps (the owner, 2026-11-05: "add a help feature so
 * employees can understand everything"). One page, a search box, one section per job; the marketing sections only for
 * someone who has marketing (lib/roles.ts `alsoMarketing`). Words match the buttons on the screens they describe.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Search } from 'lucide-react';
import { useAuth } from '@/components/auth/google-auth-gate';
import { roleForEmail, alsoMarketing } from '@/lib/roles';
import { devRole } from '@/lib/dev-role';
import { STORE_CONFIG, STORE_METAL_WORD } from '@/lib/store-config';
import { cn } from '@/lib/utils';

interface Guide {
  id: string;
  title: string;
  /** Where it is done, linked from the guide. */
  where?: { href: string; label: string };
  steps: string[];
  tip?: string;
  /** Only for someone with the marketing tools. */
  marketing?: boolean;
}

const GUIDES = (shop: string, metal: string): { section: string; guides: Guide[] }[] => [
  {
    section: 'Selling',
    guides: [
      {
        id: 'sale', title: 'Make a sale (an invoice)', where: { href: '/new', label: 'New sale' },
        steps: [
          'Tap New sale (top of the menu), or scan the piece\'s tag with Scan a tag.',
          'Add each piece: scan or search it in stock, or add a custom piece with its weight, karat and charges. The price is worked out from today\'s rate.',
          'Choose the customer (search by name or number), or leave it as a walk-in.',
          'Add a discount or gold taken in exchange if there is one.',
          'Enter what the customer paid and how (cash, card, bank transfer). Anything left shows as due.',
          'Tap Create invoice. The invoice opens: from there you can send it to the customer on WhatsApp or print it.',
        ],
        tip: 'Leave a sale halfway and it waits in Drafts under its own name. New sale always starts blank.',
      },
      {
        id: 'payment', title: 'Take a payment on an invoice', where: { href: '/invoices', label: 'Invoices' },
        steps: [
          'Open Invoices and tap the customer\'s invoice (search by name or invoice number).',
          'Tap Record a payment, enter the amount and how it was paid, then Confirm.',
          'The balance due goes down; paid in full when nothing is left.',
        ],
      },
      {
        id: 'send', title: 'Send an invoice or order to the customer',
        steps: [
          'Open the invoice or order.',
          `Tap Send to customer: the PDF goes on WhatsApp from ${shop}'s own number. Check the WhatsApp number first.`,
          'Or use the printer button to print it, or Share to send it another way.',
        ],
      },
    ],
  },
  {
    section: 'Orders',
    guides: [
      {
        id: 'order', title: 'Take an order', where: { href: '/orders/add', label: 'New order' },
        steps: [
          'Tap New order.',
          'Choose the customer (or add a new one).',
          'Add each piece: what it is, size, stones, finish, the expected weight, and a reference photo or several.',
          'Set the date the customer was promised.',
          'If the customer pays something now, record it as the advance with how it was paid.',
          'Save. The order appears in Orders under its stage.',
        ],
        tip: 'Sizes you enter can be saved to the customer\'s profile when you are asked, so next time they are already there.',
      },
      {
        id: 'find-order', title: 'Check and update an order', where: { href: '/orders', label: 'Orders' },
        steps: [
          'Open Orders: orders are grouped by stage, each card shows its next step and when it is due.',
          'Tap an order to open it. Use the ⋯ menu to Record an advance for money received, or Mark ready when the karigar has finished.',
          'When a piece comes back from the karigar, enter its final weight; the price follows.',
          'When every piece is ready the card says Ready; when the customer collects, tap Finalize & invoice: the advances come across as payments and the rest is taken on the invoice.',
        ],
        tip: 'Late orders are marked red, due today amber. Home lists what is due first.',
      },
      {
        id: 'karigar', title: 'Send an order\'s pieces to a karigar',
        steps: [
          'Open the order.',
          'Tap Send to karigar and choose the karigar.',
          'They get the photo and the description on WhatsApp (never a price). The piece shows in Workshop as with them.',
        ],
      },
    ],
  },
  {
    section: 'Repairs',
    guides: [
      {
        id: 'repair', title: 'Take in a repair', where: { href: '/repairs?new=1', label: 'New repair' },
        steps: [
          'Tap New repair.',
          'Enter the customer and phone, then each piece and what needs doing. Add another piece for more than one.',
          'Set Ready by, the charge, and any advance received.',
          'Save. The ticket is In the shop.',
        ],
      },
      {
        id: 'repair-ready', title: 'Repair ready and collected', where: { href: '/repairs', label: 'Repairs' },
        steps: [
          'When the work is done, tap Ready on the ticket, then Tell them to message the customer that it is ready.',
          'When they collect, take the balance due and tap Hand back.',
        ],
      },
    ],
  },
  {
    section: 'Workshop',
    guides: [
      {
        id: 'workshop', title: 'Follow work with the karigars', where: { href: '/workshop', label: 'Workshop' },
        steps: [
          'Workshop shows every piece being made, by karigar, oldest first. A piece sitting too long is marked.',
          'Each piece shows its status: Pending, In Progress or Completed. Change it as the work moves; tap a piece to see its order.',
          'Given items lists what metal or pieces are out with each karigar.',
        ],
      },
    ],
  },
  {
    section: 'Customers',
    guides: [
      {
        id: 'customer', title: 'Add or find a customer', where: { href: '/customers', label: 'Customers' },
        steps: [
          'Open Customers and search by name or phone number.',
          'Tap New customer to add one: name and WhatsApp number at least.',
          'A customer\'s page shows their orders, invoices and sizes. The Contact button calls or messages them.',
        ],
      },
      {
        id: 'drafts', title: 'Finish something you started', where: { href: '/drafts', label: 'Drafts' },
        steps: [
          'A sale or order you did not save waits in Drafts, saved as you typed.',
          'Open it to carry on where you left off, or delete it if it is not needed.',
        ],
      },
    ],
  },
  {
    section: 'Marketing',
    guides: [
      {
        id: 'photos', title: 'Add photos of pieces to the website', where: { href: '/website/photos', label: 'Add photos' }, marketing: true,
        steps: [
          'Open Website → Add photos.',
          `Choose the photos, the collection, and the piece's details (${metal.toLowerCase()} weight, stones).`,
          'Upload. They appear on the website shortly after.',
        ],
      },
      {
        id: 'edit', title: 'Edit a piece on the website', where: { href: '/website/edit', label: 'Edit a piece' }, marketing: true,
        steps: ['Open Website → Edit a piece, find the piece, change its name, words or photos, and save. The website keeps the change.'],
      },
      {
        id: 'design', title: 'Make a post or story', where: { href: '/design', label: 'Design' }, marketing: true,
        steps: [
          'Open Posts → Design. Start from a piece on the website or your own photo.',
          'Choose the shape (story, square), arrange the text, and Publish.',
          'Publish sends it where you tick: Instagram, the WhatsApp community, the website.',
          'Posts → Stories has a ready story for each day from the website\'s pieces: post it or skip it.',
        ],
      },
      {
        id: 'ads', title: 'Make an ad', where: { href: '/ads/new', label: 'New ad' }, marketing: true,
        steps: [
          'Open Ads → New ad, choose the design and the words.',
          'Save it. It is made paused: an owner sets the budget and turns it on.',
          'Ad results and Insights show how ads and posts did (reach, clicks, followers).',
        ],
      },
    ],
  },
];

export default function HelpPage() {
  const { user } = useAuth();
  const role = devRole() ?? roleForEmail(user?.email);
  const marketing = role === 'owner' || role === 'marketing' || (!devRole() && alsoMarketing(user?.email));
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const sections = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return GUIDES(STORE_CONFIG.name, STORE_METAL_WORD)
      .map(s => ({
        ...s,
        guides: s.guides.filter(g => (marketing || !g.marketing)
          && words.every(w => `${s.section} ${g.title} ${g.steps.join(' ')} ${g.tip ?? ''}`.toLowerCase().includes(w))),
      }))
      .filter(s => s.guides.length > 0);
  }, [q, marketing]);

  return (
    <div className="container mx-auto max-w-3xl space-y-5 px-4 py-5 md:py-6">
      <header className="space-y-1">
        <h1 className="text-ios-large font-bold text-foreground">Help</h1>
        <p className="text-ios-sub text-muted-foreground">How to do each thing in the ERP, step by step. Tap a question to open it.</p>
      </header>

      <label className="flex items-center gap-2 rounded-full bg-card px-4 py-2.5">
        <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search, e.g. payment, repair, photos"
          className="min-w-0 flex-1 bg-transparent text-ios-sub outline-none placeholder:text-muted-foreground" aria-label="Search help" />
      </label>

      {sections.length === 0 && <p className="py-8 text-center text-ios-sub text-muted-foreground">Nothing matches “{q}”. Try another word.</p>}

      {sections.map(s => (
        <section key={s.section} className="space-y-2">
          <h2 className="px-1 text-ios-cap font-semibold uppercase tracking-[.8px] text-muted-foreground">{s.section}</h2>
          <div className="overflow-hidden rounded-card bg-card">
            {s.guides.map((g, i) => {
              const isOpen = open === g.id || q.trim().length > 0;
              return (
                <div key={g.id} className={cn(i > 0 && 'border-t border-border/60')}>
                  <button type="button" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                    <span className="flex-1 text-ios-sub font-semibold text-foreground">{g.title}</span>
                    <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} aria-hidden />
                  </button>
                  {isOpen && (
                    <div className="space-y-3 px-4 pb-4">
                      <ol className="list-decimal space-y-1.5 pl-5 text-ios-sub text-foreground marker:text-muted-foreground">
                        {g.steps.map((step, k) => <li key={k}>{step}</li>)}
                      </ol>
                      {g.tip && <p className="rounded-xl bg-primary/[.08] px-3 py-2 text-ios-foot text-foreground">{g.tip}</p>}
                      {g.where && (
                        <Link href={g.where.href} className="inline-flex rounded-full bg-primary/[.12] px-3.5 py-1.5 text-ios-foot font-semibold text-primary">
                          Open {g.where.label} ›
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="px-1 text-ios-foot text-muted-foreground">Something not here, or not working as it says? Ask an owner.</p>
    </div>
  );
}
