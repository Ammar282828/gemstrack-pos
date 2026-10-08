"use client";

import React, { useState, useEffect, createContext, useContext } from 'react';
import { auth, db } from '@/lib/firebase';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, LogIn, Copy, ExternalLink } from 'lucide-react';
import { STORE_CONFIG } from '@/lib/store-config';
import { roleForEmail } from '@/lib/roles';
import { captureDevRole } from '@/lib/dev-role';
import { appSignInAdvice, chromeIntent, embeddedBrowser, signInAdvice, type EmbeddedBrowser } from '@/lib/sign-in-trouble';
import { AppSignInError, googleIdTokenFromApp, inApp as inIphoneApp, inNativeApp, isAppUserAgent } from '@/lib/native-app';
import dynamic from 'next/dynamic';

// Loaded lazily so the store app's bundle is not pulled in for karigars.
const KarigarPortal = dynamic(() => import('@/app/my-work/page'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  ),
});

const googleProvider = new GoogleAuthProvider();

// Owners and shop-floor staff both sign in here. What they can then reach is
// decided by their role, not by this gate — staff are denied Firestore
// directly (firestore.rules) and read through /api/staff/*, so getting past
// this screen grants nothing on its own.
const isAllowed = (user: User | null) => roleForEmail(user?.email) !== 'none';

/**
 * Local UI inspection without signing in. Requires BOTH a development build
 * and an explicit ?dev=1 on the URL, so it cannot exist in any deployed
 * build — `process.env.NODE_ENV` is compiled to the literal "production"
 * there and the branch is dropped entirely. It skips the sign-in screen only;
 * Firestore rules and the /api/karigar server checks are untouched, so no
 * data is exposed that a signed-out browser could not already request.
 */
/** `?as=staff` is captured here, not in the layout: the layout only mounts
 *  after sign-in, so the parameter was gone by the time anything read it. */
function useCaptureDevRole(): void {
  React.useEffect(() => { captureDevRole(); }, []);
}

function useDevBypass(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    setOn(new URLSearchParams(window.location.search).get('dev') === '1');
  }, []);
  return on;
}

/**
 * NEXT_PUBLIC_OPEN_ACCESS=1 removes the sign-in screen, and every route's owner check.
 *
 * Taheri ran that way from 2026-09-07 (Ammar's request then) to 2026-09-30, paired with
 * open Firestore rules — which were the real boundary: with them open, anybody who had the
 * public config could read and write every customer, phone number and the whole ledger,
 * sign-in screen or not. Both houses now sign in (apphosting.taheri.yaml sets it "0"), and
 * firestore.rules is Taheri's locked set. Turning it back on means opening both again.
 */
const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

function parseUserAgent(ua: string): { browser: string; os: string } {
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';

  if (isAppUserAgent(ua)) browser = 'ERP app';
  else if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/OPR\/|Opera\//.test(ua)) browser = 'Opera';

  if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) os = 'macOS';
  else if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { browser, os };
}

async function logSignIn(user: User) {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const { browser, os } = parseUserAgent(ua);
    await addDoc(collection(db, 'signInLogs'), {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      browser,
      os,
      userAgent: ua,
      timestamp: serverTimestamp(),
    });
  } catch {
    // Non-critical — don't block auth
  }
}

/**
 * What went wrong with a sign-in, to the server log (/api/auth/trouble): Google's sign-in fails on
 * the phone, where the ERP could not see it — a karigar left no trace for a month (2026-10-01).
 */
function reportSignIn(stage: 'start' | 'failed' | 'refused' | 'check-failed', extra: Record<string, unknown> = {}) {
  try {
    const inApp = embeddedBrowser(navigator.userAgent);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    const body = JSON.stringify({ stage, inApp: inIphoneApp() ? 'ERP app' : inApp?.app ?? '', standalone, host: window.location.host, ...extra });
    fetch('/api/auth/trouble', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  } catch { /* never in the way of signing in */ }
}

interface AuthContextValue {
  user: User | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({ user: null, signOut: async () => {} });

export const useAuth = () => useContext(AuthContext);

const GoogleIcon = () => (
  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

export function GoogleAuthGate({ children }: { children: React.ReactNode }) {
  useCaptureDevRole();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'owner' | 'karigar' | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLoggedUidRef = React.useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        if (!isAllowed(firebaseUser)) {
          // Not an owner — it may still be a karigar. Ask the server, which is
          // the only side that can look up karigars (they have no Firestore
          // access of their own).
          // 'refused' only when the server answered that this account is nobody here: a server
          // that failed to answer (a 503 while it restarts) used to read as "not authorised" too.
          let check: 'karigar' | 'refused' | 'failed' = 'failed';
          let status = 0;
          try {
            const token = await firebaseUser.getIdToken();
            const res = await fetch('/api/karigar/me', { headers: { Authorization: `Bearer ${token}` } });
            status = res.status;
            if (res.ok) check = (await res.json().catch(() => null))?.role === 'karigar' ? 'karigar' : 'refused';
            else if (res.status === 401 || res.status === 403) check = 'refused';
          } catch { /* no answer: 'failed' */ }

          if (check !== 'karigar') {
            const email = firebaseUser.email || '';
            await firebaseSignOut(auth);
            reportSignIn(check === 'refused' ? 'refused' : 'check-failed', { email, status });
            setError(check === 'refused'
              // Named, so the karigar can tell the shop exactly which Gmail to put on his page.
              ? `${email || 'This Google account'} isn't on ${STORE_CONFIG.name}'s list. Ask the shop to put this Gmail on your karigar page, and check this is your shop's ERP address.`
              : `Signed in, but ${STORE_CONFIG.name}'s server didn't answer${status ? ` (${status})` : ''}. Try again in a minute.`);
            setUser(null);
            setIsLoading(false);
            return;
          }

          setRole('karigar');
          setUser(firebaseUser);
          setIsLoading(false);
          return;
        }
        setRole('owner');
        // Force-resolve the auth token so Firestore has it before children mount
        await firebaseUser.getIdToken();
        // Log sign-in only once per session (not on every token refresh)
        if (lastLoggedUidRef.current !== firebaseUser.uid) {
          lastLoggedUidRef.current = firebaseUser.uid;
          logSignIn(firebaseUser);
        }
      }
      setUser(firebaseUser);
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const devBypass = useDevBypass() || OPEN_ACCESS;

  // An app's built-in browser (Instagram, Facebook, a WebView), where Google refuses to sign in.
  // Read after mounting: the server has no user agent to render the same thing with.
  const [inApp, setInApp] = useState<EmbeddedBrowser | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setInApp(embeddedBrowser(navigator.userAgent)); }, []);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setError(null);
    reportSignIn('start');
    const opened = Date.now();
    try {
      if (inIphoneApp()) {
        // The iPhone app: Google signs in through the phone's own sheet, and Firebase takes its token.
        await signInWithCredential(auth, GoogleAuthProvider.credential(await googleIdTokenFromApp()));
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (err: any) {
      // Every failure is reported, a closed window too: Google's window closing without handing
      // the sign-in back reads as "closed by user", and that was the one nobody could see.
      const openFor = Math.round((Date.now() - opened) / 1000);
      reportSignIn('failed', { code: `${err?.code || String(err?.message || '').slice(0, 50)} after ${openFor}s` });
      const advice = err instanceof AppSignInError ? appSignInAdvice(err.code, err.message) : signInAdvice(err?.code, inApp);
      if (advice) setError(advice);
      else if (err?.code === 'auth/popup-closed-by-user' && openFor >= 8) {
        // Open long enough to have chosen an account: say so, rather than showing the button again as if nothing happened.
        setError('The Google window closed before sign-in finished. If you chose your account, try once more; if it happens again, tell the shop.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await firebaseSignOut(auth);
  };

  // Inside the native iPhone app the person has already signed in to the app: its pages sign in
  // with the app's Google token by themselves, once, with no button (the app refreshes the token
  // without asking). A refusal or a failure shows the usual screen.
  const triedApp = React.useRef(false);
  useEffect(() => {
    if (isLoading || user || triedApp.current || !inNativeApp() || !inIphoneApp()) return;
    triedApp.current = true;
    void handleSignIn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, user]);

  // Dev-only, and only with ?dev=1 — see useDevBypass.
  if (devBypass) {
    return (
      <AuthContext.Provider value={{ user: null, signOut: handleSignOut }}>
        {children}
      </AuthContext.Provider>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm text-center shadow-xl">
          <CardHeader className="pb-4">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <LogIn className="h-7 w-7 text-primary" />
            </div>
            <CardTitle className="text-2xl">{STORE_CONFIG.name}</CardTitle>
            <CardDescription>Sign in to access your store dashboard. Karigars: sign in with the Gmail the shop has for you.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            {inApp && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-left text-sm">
                <p>
                  This page is open inside <b>{inApp.app}</b>. Google doesn&apos;t allow signing in here —
                  open it in {inApp.platform === 'ios' ? 'Safari' : 'Chrome'}.
                </p>
                {inApp.platform === 'ios' && (
                  <p className="text-xs text-muted-foreground">Tap the ••• or share button, then <b>Open in Safari</b>. Or copy the link and paste it into Safari.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {inApp.platform === 'android' && (
                    <Button asChild size="sm"><a href={chromeIntent(window.location.href)}><ExternalLink className="mr-1.5 h-4 w-4" /> Open in Chrome</a></Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => {
                    navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true), () => setCopied(false));
                  }}><Copy className="mr-1.5 h-4 w-4" /> {copied ? 'Link copied' : 'Copy link'}</Button>
                </div>
              </div>
            )}
            {error && (
              <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>
            )}
            <Button className="w-full" size="lg" onClick={handleSignIn} disabled={isSigningIn}>
              {isSigningIn ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              Sign in with Google
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Karigars never get the store app — only their own work portal. This is a
  // convenience boundary; the real one is firestore.rules + the server-side
  // checks in /api/karigar/*, which is why a karigar cannot read anything by
  // bypassing this component.
  if (role === 'karigar') {
    return (
      <AuthContext.Provider value={{ user, signOut: handleSignOut }}>
        <KarigarPortal />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  );
}
