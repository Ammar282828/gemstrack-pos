
"use client";

import { useParams } from 'next/navigation';
import { useAppStore, Karigar } from '@/lib/store';
import { KarigarForm } from '@/components/karigar/karigar-form';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import React, { useEffect } from 'react';

export default function EditKarigarPage() {
  const params = useParams();
  const karigarId = params.id as string;
  
  const { karigars, isKarigarsLoading, loadKarigars } = useAppStore();
  
  useEffect(() => {
    loadKarigars();
  }, [loadKarigars]);

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
          <Button variant="link" className="mt-4">Go back to karigars list</Button>
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
