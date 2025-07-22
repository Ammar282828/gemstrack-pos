
"use client";

import React, { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Copy, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

export function AuthorizationProvider({ children }: { children: React.ReactNode }) {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const { toast } = useToast();
  
  const allowedDeviceIds = useAppStore(state => state.settings.allowedDeviceIds);

  useEffect(() => {
    const id = getDeviceId();
    setDeviceId(id);

    if (id) {
        // If there are no whitelisted IDs, any device is allowed. 
        // This is important for the first-time setup.
      if (allowedDeviceIds.length === 0) {
        setIsAuthorized(true);
      } else {
        setIsAuthorized(allowedDeviceIds.includes(id));
      }
    }
  }, [allowedDeviceIds]);

  const handleCopyToClipboard = () => {
    if (deviceId) {
      navigator.clipboard.writeText(deviceId);
      toast({
        title: "Copied to Clipboard",
        description: "Device ID has been copied.",
      });
    }
  };

  if (isAuthorized) {
    return <>{children}</>;
  }

  // If not authorized, show the unauthorized message
  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/40">
      <Card className="w-full max-w-md m-4">
        <CardHeader className="text-center">
          <ShieldAlert className="w-16 h-16 mx-auto text-destructive mb-4" />
          <CardTitle className="text-2xl">Device Not Authorized</CardTitle>
          <CardDescription>
            This device does not have permission to access the application. To gain access, copy this device's unique ID and add it to the whitelist in the settings on an already authorized device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <label htmlFor="deviceId" className="text-sm font-medium text-muted-foreground">Your Unique Device ID</label>
            <div className="flex items-center space-x-2">
              <Input id="deviceId" value={deviceId || 'Generating...'} readOnly className="font-mono bg-muted" />
              <Button variant="outline" size="icon" onClick={handleCopyToClipboard} disabled={!deviceId}>
                <Copy className="h-4 w-4" />
                <span className="sr-only">Copy Device ID</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground pt-2">
              If this is the first time you are running the app, the whitelist is empty, and this device should be authorized automatically. If you've added other devices, you must explicitly add this one.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
