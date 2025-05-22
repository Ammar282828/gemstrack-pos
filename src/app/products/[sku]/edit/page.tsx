"use client";

import { useParams } from 'next/navigation';
import { useAppStore, Product, useIsStoreHydrated } from '@/lib/store';
import { ProductForm } from '@/components/product/product-form';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function EditProductPage() {
  const params = useParams();
  const sku = params.sku as string;
  
  const isHydrated = useIsStoreHydrated();
  const product = useAppStore(state => state.products.find(p => p.sku === sku));

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading product data...</p></div>;
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
