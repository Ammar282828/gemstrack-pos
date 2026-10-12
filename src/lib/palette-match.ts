/**
 * How a typed word matches a page: by its name or by another word for it. A name that starts with
 * what was typed ranks above one that only contains it. Shared by the Ctrl+K palette and the phone's
 * map sheet so they always agree. Returns -1 for no match.
 */
export function scorePlace(label: string, keywords: string[] | undefined, needle: string): number {
  const n = needle.trim().toLowerCase();
  if (!n) return -1;
  const l = label.toLowerCase();
  const words = (keywords ?? []).map(k => k.toLowerCase());
  return l.startsWith(n) ? 4 : l.includes(n) ? 3
    : words.some(k => k.startsWith(n)) ? 3 : words.some(k => k.includes(n)) ? 2.5 : -1;
}
