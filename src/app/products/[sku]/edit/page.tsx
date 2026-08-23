'use client';

import { ProductForm } from '@/components/product/product-form';
import { ListSkeleton } from '@/components/shared/skeletons';
import { useAppStore } from '@/lib/store';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

export default function EditProductPage() {
  const params = useParams();
  const sku = params.sku as string;
  const { products, isProductsLoading, loadProducts } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    loadProducts();
  }, [loadProducts]);

  if (!mounted) return null;

  const product = products.find(p => p.sku === sku);

  if (isProductsLoading && !product) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Product not found</h2>
        <p className="text-muted-foreground">The product with SKU "{sku}" could not be found.</p>
        <Link href="/products" passHref>
          <Button variant="link" className="mt-4">Go back to products</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <ProductForm product={product} />
    </div>
  );
}
