"use client";

/**
 * The shop's link page — what the QR on every invoice and workshop slip points at.
 *
 * Public on purpose: no sign-in, no data, nothing from the book. It is the one page
 * here meant for customers rather than the counter, which is why it carries the
 * wordmark and none of the app's chrome.
 *
 * A link left unset is not rendered. Better three rows that work than a fourth that
 * goes nowhere — and a Google review row pointing at a guess would send customers to
 * review the wrong business.
 */

import React from 'react';
import Image from 'next/image';
import { STORE_CONFIG, STORE_LINKS, STORE_LOGO_URL } from '@/lib/store-config';
import { Instagram, Globe, Star, MessageCircle, Users } from 'lucide-react';

interface Row {
  href: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
}

export default function LinksPage() {
  const rows: Row[] = [
    {
      href: STORE_LINKS.waCommunity,
      label: 'WhatsApp community',
      sub: 'New pieces, first',
      icon: <Users className="h-5 w-5" />,
    },
    {
      href: STORE_LINKS.whatsapp || STORE_CONFIG.whatsappUrl,
      label: 'Message us',
      sub: 'Straight to the counter',
      icon: <MessageCircle className="h-5 w-5" />,
    },
    {
      href: STORE_LINKS.instagram || STORE_CONFIG.instagramUrl,
      label: 'Instagram',
      sub: 'See the work',
      icon: <Instagram className="h-5 w-5" />,
    },
    {
      href: STORE_LINKS.website,
      label: 'Our website',
      sub: 'taheri.shop',
      icon: <Globe className="h-5 w-5" />,
    },
    {
      href: STORE_LINKS.googleReview,
      label: 'Leave a review',
      sub: 'It genuinely helps',
      icon: <Star className="h-5 w-5" />,
    },
  ].filter((r) => Boolean(r.href));

  return (
    <main className="min-h-screen bg-[#faf9f7] px-5 py-14 text-[#1a1a1a]">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-10 flex justify-center">
          {/* Sized by the wordmark's true ratio, not a guessed box. */}
          <Image src={STORE_LOGO_URL} alt={STORE_CONFIG.name} width={200} height={50}
                 priority className="h-auto w-44" />
        </div>

        <p className="mb-8 text-center text-sm text-[#6b6b6b]">
          Gold &amp; diamond jewellery, Karachi
        </p>

        <div className="space-y-3">
          {rows.map((r) => (
            <a
              key={r.label}
              href={r.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-4 rounded-2xl border border-[#e6e2dc] bg-white px-5 py-4
                         transition-colors hover:border-[#1a1a1a]"
            >
              <span className="text-[#1a1a1a]">{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="block text-xs text-[#8a8a8a]">{r.sub}</span>
              </span>
            </a>
          ))}
        </div>

        {rows.length === 0 && (
          <p className="text-center text-sm text-[#8a8a8a]">
            No links have been set up yet.
          </p>
        )}

        <p className="mt-12 text-center text-[11px] tracking-wide text-[#a8a8a8]">
          {STORE_CONFIG.name}
        </p>
      </div>
    </main>
  );
}
