/**
 * Calling the voice and vision routes as the signed-in user.
 *
 * Those routes hold the shop's Gemini key and refuse anyone who cannot prove who they are,
 * so every call from the browser has to carry the Firebase ID token — the same proof the
 * staff and karigar write paths already send.
 */

import { auth } from '@/lib/firebase';

export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await auth?.currentUser?.getIdToken();
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
