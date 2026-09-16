/**
 * What shows between tapping a link and the next page's code arriving.
 *
 * Every page here is a client component that fetches after it mounts, so this
 * covers only the download of the route's own chunk — but on a phone on 4G that
 * was a blank content area for a second or two, with the sidebar sitting there
 * looking like the tap had not registered.
 */
import { PageSkeleton } from '@/components/shared/skeletons';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
      <PageSkeleton />
    </div>
  );
}
