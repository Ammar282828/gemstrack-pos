"use client";

import { ProductForm } from '@/components/product/product-form';
import { useIsStoreHydrated } from '@/lib/store';

export default function AddProductPage() {
  const isHydrated = useIsStoreHydrated();

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading form...</p></div>;
  }

  return (
    <div className="container mx-auto p-4">
      <ProductForm />
    </div>
  );
}
