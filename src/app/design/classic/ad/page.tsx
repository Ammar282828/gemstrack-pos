import { redirect } from 'next/navigation';
import { redirectFor } from '@/lib/design/redirects';

/**
 * The classic ad maker is gone: Design makes the ad now, with "Make it with AI" and "Paint the whole ad" in its AI
 * panel (docs/features/design.md, "With AI"). The address stays for links already sent.
 */
export default async function ClassicAdRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(redirectFor('/design/classic/ad', await searchParams) ?? '/design?v=make&kind=ad');
}
