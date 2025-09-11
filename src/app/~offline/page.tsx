
"use client";

import { AlertTriangle, WifiOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function OfflinePage() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <WifiOff className="mx-auto h-16 w-16 text-destructive" />
          <CardTitle className="mt-4 text-2xl">You are Offline</CardTitle>
          <CardDescription>
            It looks like you've lost your internet connection. Please check your connection and try again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This app requires an internet connection to sync data with the database. Some features may be unavailable until you reconnect.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
