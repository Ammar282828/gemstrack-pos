/** Route-level loading: a form, in the page's own shape (no spinner). */
import { FormSkeleton } from '@/components/shared/skeletons';

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
      <FormSkeleton fields={8} columns={2} />
    </div>
  );
}
