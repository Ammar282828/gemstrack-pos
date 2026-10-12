import { redirect } from 'next/navigation';
import { redirectFor } from '@/lib/design/redirects';

/**
 * From the website is the Posts hub now (2026-10-04): its pieces, picked one or several at a time, are
 * the hub's own grid (src/app/posts). The old address is kept for bookmarks and links already sent.
 */
export default async function FromSiteRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(redirectFor('/website/from-site', await searchParams) ?? '/posts');
}
