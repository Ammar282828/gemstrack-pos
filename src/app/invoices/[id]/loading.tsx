/** Route-level loading: a record page, in the page's own shape (no spinner). */
import { DetailSkeleton } from '@/components/shared/skeletons';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
      <DetailSkeleton sections={2} />
    </div>
  );
}
