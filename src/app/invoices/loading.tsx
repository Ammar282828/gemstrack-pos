/** Route-level loading: a list page, in the page's own shape (no spinner). */
import { ListSkeleton } from '@/components/shared/skeletons';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
      <ListSkeleton />
    </div>
  );
}
