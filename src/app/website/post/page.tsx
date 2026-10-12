import { redirect } from 'next/navigation';
import { redirectFor } from '@/lib/design/redirects';

/**
 * Post a piece is Design now (docs/features/design.md): the address is kept for bookmarks, the Posts hub's old
 * links and messages already sent. `?draft=`, `?site=` and `?new=1` go with it; Design opens the right draft or
 * website piece (a draft of the old screen opens in the classic one, /design/classic/post).
 */
export default async function PostAPieceRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(redirectFor('/website/post', await searchParams) ?? '/design');
}
