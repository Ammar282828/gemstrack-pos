import { redirect } from 'next/navigation';
import { redirectFor } from '@/lib/design/redirects';

/**
 * The classic Post a piece screen is gone: Design does everything it did (docs/features/design.md, "With AI"). The
 * address stays for links already sent and for the phone's share targets; `?draft=` goes with it — Design opens a
 * draft of the old screen as a design.
 */
export default async function ClassicPostRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(redirectFor('/design/classic/post', await searchParams) ?? '/design');
}
