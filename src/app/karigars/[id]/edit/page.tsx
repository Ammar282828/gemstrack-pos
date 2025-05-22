
"use client";

import { useParams } from 'next/navigation';
import { useAppStore, Karigar, useIsStoreHydrated } from '@/lib/store';
import { KarigarForm } from '@/components/karigar/karigar-form';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function EditKarigarPage() {
  const params = useParams();
  const karigarId = params.id as string;
  
  const isHydrated = useIsStoreHydrated();
  const karigar = useAppStore(state => state.karigars.find(k => k.id === karigarId));

  if (!isHydrated) {
    return <div className="container mx-auto p-4"><p>Loading karigar data...</p></div>;
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
