/**
 * Every Ads page, with the Ads helper floating over it — only here (the owner,
 * 2026-09-27: "it should float around in the ads tab only").
 */

import type { ReactNode } from 'react';
import { STORE_META_ADS } from '@/lib/store-config';
import { AdsAssistant } from './assistant';

export default function AdsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {STORE_META_ADS && <AdsAssistant />}
    </>
  );
}
