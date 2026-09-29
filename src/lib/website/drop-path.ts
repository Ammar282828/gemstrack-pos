/**
 * A drop's address on taheri.shop, by the site's own rules (App.jsx NAME_TO_SLUG: the collection
 * folder lowercased with dashes; seo.js legacyPieceSlug: the file name the same way, a bare number
 * prefixed with its collection). The prerender writes pages only for adopted photographs, so until
 * 2026-09-29 a drop's address answered 404 and posting never offered it (the owner: "new stone sets
 * not visible in post from the website"); the site's api/piece.php now serves it, named and previewed.
 */
export function dropPath(key: string): string | null {
  const parts = key.split('/');
  if (parts.length < 3) return null;
  const col = parts[parts.length - 2].toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const s = parts[parts.length - 1].replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!col) return null;
  return `/${col}/${!s || /^\d+$/.test(s) ? `${col}-${s || 'piece'}` : s}`;
}
