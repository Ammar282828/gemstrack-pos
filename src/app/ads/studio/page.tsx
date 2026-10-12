import { redirect } from 'next/navigation';
import { redirectFor } from '@/lib/design/redirects';

/**
 * The Studio is gone as a tab (docs/features/design.md): its Plan is Ads → Plan and its Photos, Make, Board and
 * Saved are Design's. The address and its `?v=` / `?s=` stay for bookmarks, the iPhone app and links sent.
 */
export default async function StudioRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(redirectFor('/ads/studio', await searchParams) ?? '/ads/plan');
}
