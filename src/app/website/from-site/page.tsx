import { redirect } from 'next/navigation';

/**
 * From the website is the Posts hub now (2026-10-04): its pieces, picked one or several at a time, are
 * the hub's own grid (src/app/posts). The old address is kept for bookmarks and links already sent.
 */
export default async function FromSiteRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  redirect(q.toString() ? `/posts?${q}` : '/posts');
}
