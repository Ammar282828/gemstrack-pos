"use client";

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ProductForm } from '@/components/product/product-form';
import { takeHandoff } from '@/lib/voice/handoff';
import type { Product } from '@/lib/store';
import { FormSkeleton } from '@/components/shared/skeletons';

function AddProductInner() {
  // ?voice=1: the piece as it was described to the voice assistant (lib/voice/handoff.ts), taken once.
  const params = useSearchParams();
  const [seed] = useState(() => (params.get('voice') === '1' ? takeHandoff<Partial<Product>>('piece') ?? undefined : undefined));
  return <ProductForm seed={seed} />;
}

export default function AddProductPage() {
  return (
    <div className="container mx-auto p-4">
      <Suspense fallback={<FormSkeleton fields={8} columns={2} />}>
        <AddProductInner />
      </Suspense>
    </div>
  );
}
