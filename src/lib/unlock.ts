/**
 * The counter passcode.
 *
 * Sign-in is off, so this is what stands between the shop's screens and anyone who
 * happens to have the address. It is checked in middleware, before the page is
 * rendered, so a locked-out visitor is never sent the POS markup at all.
 *
 * WHAT THIS IS NOT: it is not a login and it does not protect the data. The browser
 * talks to Firestore directly, and while the rules are open those reads and writes do
 * not pass through this gate — anyone who knows the project id can still reach the
 * collections without ever loading a page. This stops a stranger who finds the URL
 * from seeing the shop's screens. Closing NEXT_PUBLIC_OPEN_ACCESS and restoring
 * firestore.rules.locked is what closes the data; this is a stand-in until then, and
 * effort spent hardening it past that point is effort spent on the wrong door.
 *
 * ON THE DEFAULT: '5152' is a four-digit counter code, chosen by the shop and set here
 * so the app cannot boot into a state where nobody can get in. The repository is
 * private. POS_PASSCODE overrides it, which is how it gets changed without a deploy —
 * and the fallback stays because this value is read inside middleware, where throwing
 * on a missing variable takes the whole site down on every request rather than
 * failing safe.
 */

export const PASSCODE = process.env.POS_PASSCODE || '5152';
export const UNLOCK_COOKIE = 'taheri_unlock';

/**
 * Mixed into the cookie hash so the cookie cannot be computed from the passcode alone.
 *
 * Without this, anyone who guessed or learned the code could mint the cookie offline
 * and walk straight past the attempt limit on the route — the limit would only govern
 * the door it was watching. Constant by default: a deployment that never sets it is no
 * worse off than one without a pepper, and one that does gets a cookie nobody can forge.
 */
const PEPPER = process.env.POS_UNLOCK_PEPPER || 'taheri-unlock';

/** Thirty days: long enough that the counter isn't retyping it, short enough to expire. */
export const UNLOCK_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Web Crypto rather than node:crypto — this has to give the same answer in Edge
 * middleware and in the Node route that sets the cookie.
 */
export async function unlockToken(code: string): Promise<string> {
  const data = new TextEncoder().encode(`${PEPPER}::${code}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
