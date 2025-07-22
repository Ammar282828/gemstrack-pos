
"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArchiveRestore, ExternalLink, HelpCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useAppStore } from '@/lib/store';
import Link from 'next/link';

export default function BackupRestorePage() {
  const projectId = useAppStore(state => state.settings.firebaseConfig?.projectId);

  const firestoreConsoleUrl = projectId 
    ? `https://console.cloud.google.com/firestore/databases/-default-/pitr?project=${projectId}`
    : 'https://console.cloud.google.com/';

  return (
    <div className="container mx-auto p-4 space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl flex items-center">
            <ArchiveRestore className="mr-3 h-7 w-7 text-primary" />
            Database Backups &amp; Restore
          </CardTitle>
          <CardDescription>
            Manage database backups using Firestore's Point-in-Time Recovery (PITR). This feature must be enabled in your Google Cloud project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-4 border rounded-lg bg-secondary/30">
            <h3 className="font-semibold text-lg flex items-center mb-2">
              <HelpCircle className="mr-2 h-5 w-5" />
              What is Point-in-Time Recovery (PITR)?
            </h3>
            <p className="text-muted-foreground">
              PITR provides continuous backups of your database, protecting you from accidental deletions or data corruption. When enabled, Firestore retains historical versions of your data, allowing you to restore your database to any specific minute within the last 7 days.
            </p>
            <p className="text-muted-foreground mt-2">
              This is a powerful safety net for your business data. The restoration process is handled securely through the Google Cloud Console, not directly within this application.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-2">How to Manage Backups</h3>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
              <li>
                <strong>Enable PITR:</strong> If you haven't already, you must enable this feature in your project's Google Cloud Console.
              </li>
              <li>
                <strong>Access the Restore Tool:</strong> Use the button below to go directly to the Firestore backup management page for your project.
              </li>
              <li>
                <strong>Initiate a Restore:</strong> Follow the on-screen instructions in the Google Cloud Console to select a point in time and start the restore process. The process creates a new database with the restored data.
              </li>
            </ol>
          </div>

          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Important: Restoration is an Advanced Action</AlertTitle>
            <AlertDescription>
              Restoring your database will overwrite your current data with the data from the backup point. This action cannot be undone. Always be certain before initiating a restore. It's recommended to consult the official documentation or a technical expert if you are unsure.
            </AlertDescription>
          </Alert>
          
          <div className="text-center pt-4">
            <Button asChild size="lg">
              <a href={firestoreConsoleUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-5 w-5" />
                Manage Backups in Google Cloud Console
              </a>
            </Button>
            {!projectId && (
                <p className="text-sm text-destructive mt-2">
                    Could not determine your Firebase Project ID. Please ensure it is set correctly in your environment variables.
                </p>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
}
