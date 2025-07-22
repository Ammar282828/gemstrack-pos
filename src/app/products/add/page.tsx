"use client";

import { ProductForm } from '@/components/product/product-form';
import { useAppReady } from '@/lib/store';
import { Loader2 } from 'lucide-react';

export default function AddProductPage() {
  const appReady = useAppReady();

  if (!appReady) {
     return (
      <div className="container mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Product Form...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <ProductForm />
    </div>
  );
}
