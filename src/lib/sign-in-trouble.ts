/**
 * Why a Google sign-in did not happen, in words the person at the phone can act on.
 *
 * Found 2026-10-01 (owner: "why can't Uzair my karigar access his part"): Uzair's Gmail was on
 * his House of Mina record, yet in a month of logs no sign-in of his ever reached the server.
 * Google's sign-in was failing on his phone, before the ERP could see anything, and the screen
 * said nothing useful — or, if the server hiccupped while checking him, "not authorised".
 * Google refuses to sign in inside the browsers apps build in (Instagram, Facebook, an Android
 * WebView, an iPhone app's own web view): the page has to be opened in Chrome or Safari.
 */

export interface EmbeddedBrowser {
  /** "Instagram", "Facebook"… or "this app" when only the kind of view gives it away. */
  app: string;
  platform: 'android' | 'ios' | 'other';
}

const NAMED: [RegExp, string][] = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/Messenger/i, 'Messenger'],
  [/\bLine\//i, 'LINE'],
  [/Snapchat/i, 'Snapchat'],
  [/TikTok|musical_ly|BytedanceWebview/i, 'TikTok'],
  [/WhatsApp/i, 'WhatsApp'],
];

/** The browser an app builds in, where Google will not sign anyone in; null for a real browser. */
export function embeddedBrowser(ua: string | null | undefined): EmbeddedBrowser | null {
  const s = String(ua ?? '');
  if (!s) return null;
  const platform = /Android/i.test(s) ? 'android' : /iPhone|iPad|iPod/i.test(s) ? 'ios' : 'other';
  const named = NAMED.find(([re]) => re.test(s));
  if (named) return { app: named[1], platform };
  // Android's WebView marks itself "; wv)"; Chrome Custom Tabs (what WhatsApp and Gmail use) do not.
  if (platform === 'android' && /; wv\)/.test(s)) return { app: 'this app', platform };
  // An iPhone app's own web view has no "Safari/" token; Safari, Chrome (CriOS), Firefox and Edge do.
  if (platform === 'ios' && /AppleWebKit/i.test(s) && !/Safari\//i.test(s) && !/CriOS|FxiOS|EdgiOS/i.test(s)) {
    return { app: 'this app', platform };
  }
  return null;
}

/** A link that opens this page in Chrome from an Android app's built-in browser. */
export function chromeIntent(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
}

/** What to tell the person when Firebase's sign-in throws; null when there is nothing to say. */
export function signInAdvice(code: string | null | undefined, inApp: EmbeddedBrowser | null): string | null {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return null; // they closed it themselves
    case 'auth/popup-blocked':
      return 'The browser blocked the Google window. Allow pop-ups for this site, then tap Sign in again.';
    case 'auth/operation-not-supported-in-this-environment':
    case 'auth/web-storage-unsupported':
      return inApp
        ? `Google won't sign in inside ${inApp.app}. Open this page in ${inApp.platform === 'ios' ? 'Safari' : 'Chrome'} (below).`
        : 'This browser has storage turned off, so Google cannot sign in. Open the page in Chrome or Safari.';
    case 'auth/network-request-failed':
      return 'No connection to Google. Check the internet and try again.';
    case 'auth/unauthorized-domain':
      return `This address (${typeof window !== 'undefined' ? window.location.host : 'here'}) is not set up for Google sign-in. Use the shop's usual ERP address.`;
    case 'auth/admin-restricted-operation':
      // The project lets in only accounts that already exist ("Enable create (sign-up)" off): a first
      // sign-in is refused before the ERP hears of it. Uzair, House of Mina, 2026-10-01.
      return "This Google account hasn't been let in yet: the shop has to allow new sign-ins while you sign in the first time. Ask them, then tap Sign in again.";
    case 'auth/too-many-requests':
      return 'Too many tries. Wait a minute, then try again.';
    default:
      return inApp
        ? `Sign-in failed — Google doesn't work inside ${inApp.app}. Open this page in ${inApp.platform === 'ios' ? 'Safari' : 'Chrome'}.`
        : `Sign-in failed${code ? ` (${code.replace(/^auth\//, '')})` : ''}. Please try again.`;
  }
}
