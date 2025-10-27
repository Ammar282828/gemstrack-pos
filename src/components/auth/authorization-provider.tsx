
"use client";

import React from 'react';
import { useAppReady } from '@/hooks/use-store';

/**
 * This component previously handled device ID-based authorization.
 * The feature has been removed, and this now acts as a simple pass-through
 * to ensure the application starts correctly without needing authorization checks.
 */
export function AuthorizationProvider({ children }: { children: React.ReactNode }) {
  const appReady = useAppReady();

  // We still wait for the app to be ready before rendering children to prevent
  // hydration issues or rendering with incomplete initial state.
  if (!appReady) {
    return null;
  }

  return <>{children}</>;
}
