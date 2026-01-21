
"use client";

import { KarigarForm } from '@/components/karigar/karigar-form';
import { useAppStore } from '@/lib/store';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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
      <div className="container mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading karigar data...</p>
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
