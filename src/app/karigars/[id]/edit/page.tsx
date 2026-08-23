
"use client";

import { KarigarForm } from '@/components/karigar/karigar-form';
import { ListSkeleton } from '@/components/shared/skeletons';
import { useAppStore } from '@/lib/store';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';

export default function EditKarigarPage() {
  const params = useParams();
  const karigarId = params.id as string;
  const { karigars, isKarigarsLoading, loadKarigars } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    loadKarigars();
  }, [loadKarigars]);

  if (!mounted) return null;

  const karigar = karigars.find(k => k.id === karigarId);

  if (isKarigarsLoading && !karigar) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  if (!karigar) {
    return (
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Karigar not found</h2>
        <p className="text-muted-foreground">The karigar with ID "{karigarId}" could not be found.</p>
        <Link href="/karigars" passHref>
          <Button variant="link" className="mt-4">Go back to karigars</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      <KarigarForm karigar={karigar} />
    </div>
  );
}
