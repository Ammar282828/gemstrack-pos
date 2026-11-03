/** Route-level loading: figures and panels, in the page's own shape (no spinner). */
import { BoardSkeleton } from '@/components/shared/skeletons';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
      <BoardSkeleton tiles={4} panels={2} />
    </div>
  );
}
