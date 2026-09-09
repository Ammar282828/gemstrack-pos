/**
 * The counter passcode.
 *
 * Sign-in is off, so this is what stands between the shop's screens and anyone who
 * happens to have the address. It is checked in middleware, before the page is
 * rendered, so an unlocked visitor is never sent the POS markup at all.
 *
 * WHAT THIS IS NOT: it is not a login and it does not protect the data. The browser
 * talks to Firestore directly, and while the rules are open those reads and writes do
 * not pass through this gate — anyone who knows the project id can still reach the
 * collections. This stops a stranger who finds the URL from seeing the shop's screens.
 * Closing NEXT_PUBLIC_OPEN_ACCESS and restoring firestore.rules.locked is what closes
 * the data, and this is a stand-in until then.
 *
 * The cookie holds a hash rather than the code, so the code itself is never written to
 * disk on the shop's phones, and never leaves the server.
 */

export const PASSCODE = process.env.POS_PASSCODE || '5152';
export const UNLOCK_COOKIE = 'taheri_unlock';

/** Thirty days: long enough that the counter isn't retyping it, short enough to expire. */
export const UNLOCK_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Web Crypto rather than node:crypto — this has to give the same answer in Edge
 * middleware and in the Node route that sets the cookie.
 */
export async function unlockToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`taheri-unlock::${code}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
