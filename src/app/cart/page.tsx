import { redirect } from 'next/navigation';

/**
 * The old address of the sale form and the invoice screen, kept for links already sent, bookmarked or
 * saved in old drafts and WhatsApp messages: `/cart?invoice_id=<id>` → `/invoices/<id>`, anything else
 * → `/invoices/new` with its query (`?draft=`, `?scan=bill`, `?dev=1`).
 */
export default async function CartRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rest = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === 'invoice_id') continue;
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) rest.append(k, one);
  }
  const q = rest.toString() ? `?${rest}` : '';
  const id = typeof sp.invoice_id === 'string' ? sp.invoice_id.trim() : '';
  redirect(id ? `/invoices/${encodeURIComponent(id)}${q}` : `/invoices/new${q}`);
}
