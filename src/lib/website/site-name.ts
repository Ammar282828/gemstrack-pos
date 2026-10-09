/**
 * A house website's address as the counter says it: "https://www.taheri.shop/" → "taheri.shop".
 * The website pages each wrote this inline (`SITE.replace(/^https?:\/\/(www\.)?/, '')`); the
 * iPhone app reads it from /api/app/website.
 */
export function siteNameOf(url: string | null | undefined): string {
  const bare = String(url || '').trim().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '');
  return bare || 'the website';
}
