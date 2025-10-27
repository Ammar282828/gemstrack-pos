
"use client";

import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TabletSmartphone, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DEVICE_ID_KEY = 'gemstrack-device-id';

function getDeviceId() {
  if (typeof window === 'undefined') {
    return null;
  }
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

const UnauthorizedDevice: React.FC = () => {
    const [deviceId, setDeviceId] = useState<string | null>(null);
    useEffect(() => {
        setDeviceId(getDeviceId());
    }, []);

    const handleCopyToClipboard = () => {
        if (deviceId) {
            navigator.clipboard.writeText(deviceId);
            alert("Device ID copied to clipboard!");
        }
    };

    return (
        <div className="flex h-screen w-full items-center justify-center bg-destructive/10 p-4">
            <Card className="w-full max-w-md border-destructive">
                <CardHeader className="text-center">
                    <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
                    <CardTitle className="mt-4 text-2xl">Access Denied</CardTitle>
                    <CardDescription>This device is not authorized to access the application.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-center text-muted-foreground">
                        To gain access, please provide the following Device ID to an administrator to have it added to the list of authorized devices.
                    </p>
                    <div className="mt-4 rounded-md border bg-muted p-4">
                        <div className="flex items-center gap-3">
                            <TabletSmartphone className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                            <p className="flex-grow break-all text-sm font-mono">{deviceId || 'Generating...'}</p>
                        </div>
                    </div>
                     <Button onClick={handleCopyToClipboard} className="w-full mt-4" disabled={!deviceId}>
                        Copy Device ID
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};


export function AuthorizationProvider({ children }: { children: React.ReactNode }) {
  // --- TEMPORARILY DISABLED TO ALLOW USER TO REGAIN ACCESS ---
  // The original logic is commented out below. This will be restored
  // once the user has had a chance to add their device ID via the UI.
  
  return <>{children}</>;

  /*
  const appReady = useAppReady();
  const allowedDeviceIds = useAppStore(state => state.settings.allowedDeviceIds);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (appReady) {
      const currentDeviceId = getDeviceId();
      // If the allowed list is empty, any device is allowed. This is the default state.
      if (!allowedDeviceIds || allowedDeviceIds.length === 0) {
        setIsAuthorized(true);
      } else if (currentDeviceId) {
        setIsAuthorized(allowedDeviceIds.includes(currentDeviceId));
      }
      setIsChecking(false);
    }
  }, [appReady, allowedDeviceIds]);

  if (!appReady || isChecking) {
    // Return null or a loader to prevent rendering children prematurely
    return null;
  }

  if (!isAuthorized) {
    return <UnauthorizedDevice />;
  }

  return <>{children}</>;
  */
}
