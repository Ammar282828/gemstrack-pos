
"use client";

import { KarigarForm } from '@/components/karigar/karigar-form';
import { useIsStoreHydrated } from '@/lib/store';

export default function AddKarigarPage() {
  const isHydrated = useIsStoreHydrated();

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading form...</p></div>;
  }
  return (
    <div className="container mx-auto p-4">
      <KarigarForm />
    </div>
  );
}
