'use client';

import { useEffect, useState } from 'react';

let known: boolean | null = null;
let inflight: Promise<boolean> | null = null;
export const forgetPaymentLinks = () => { known = null; inflight = null; };

/** Whether this house has Safepay connected (GET /api/app/business → flags.paymentLinks); asked once per page load. */
export function usePaymentLinksOn(): boolean {
  const [on, setOn] = useState<boolean>(known ?? false);
  useEffect(() => {
    if (known !== null) { setOn(known); return; }
    inflight ??= fetch('/api/app/business')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { known = !!d?.flags?.paymentLinks; return known; })
      .catch(() => { inflight = null; return false; });
    let live = true;
    inflight.then(v => { if (live) setOn(v); });
    return () => { live = false; };
  }, []);
  return on;
}
