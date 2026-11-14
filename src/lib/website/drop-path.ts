/**
 * A drop's address on taheri.shop, by the site's own rules (App.jsx NAME_TO_SLUG: the collection
 * folder lowercased with dashes; seo.js legacyPieceSlug: the file name the same way, a bare number
 * prefixed with its collection). The prerender writes pages only for adopted photographs, so until
 * 2026-09-29 a drop's address answered 404 and posting never offered it (the owner: "new stone sets
 * not visible in post from the website"); the site's api/piece.php now serves it, named and previewed.
 */
export function dropPath(key: string, slugs: Record<string, string> = {}): string | null {
  const parts = key.split('/');
  if (parts.length < 3) return null;
  const col = parts[parts.length - 2].toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const stem = parts[parts.length - 1].replace(/\.[^.]+$/, '');
  const s = stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!col) return null;
  // A drop the counter has named has its name for an address (2026-11-14): taheri.shop's drop-slugs.json,
  // "<collection>/<file stem>" → slug. Its file-name address still answers there, as a 301 to this one.
  const named = slugs[`${col}/${stem}`];
  if (typeof named === 'string' && named) return `/${col}/${named}`;
  return `/${col}/${!s || /^\d+$/.test(s) ? `${col}-${s || 'piece'}` : s}`;
}
