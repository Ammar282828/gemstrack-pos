/**
 * A community's twin. "Taheri Collections" filled up (WhatsApp's member cap), so the owner opened
 * "Taheri Collections - II" with the same groups, 2026-10-12: "the whatsapp api pointing to any of the
 * first communities groups should point here also automatically". Every send to a group of the first
 * community also goes to the group of the same name in the second; the announcements to the
 * announcements. Pairs are found by name at send time, so a group added to the new community later
 * is reached from its first send, with nothing to configure.
 *
 *   WHATSAPP_COMMUNITY_TWINS  "<old community id>=<new community id>,…" (the parent …@g.us ids)
 *
 * Pure: the lookup is in whatsapp.ts.
 */

export interface WaGroup { id: string; name: string; parent: string; announce: boolean }

export function communityTwins(raw = process.env.WHATSAPP_COMMUNITY_TWINS || ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of raw.split(',')) {
    const [from, to] = part.split('=').map(s => (s || '').trim());
    if (/^\d+@g\.us$/.test(from) && /^\d+@g\.us$/.test(to) && from !== to) out.set(from, to);
  }
  return out;
}

/** A group's name without its emoji, case, spacing or a trailing "II" / "2": "Diamonds by Taheri 💎" = "diamonds by taheri II". */
export const twinName = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+(ii|2)\s*$/, '').replace(/\s+/g, '');

/** The twin of a chat in the newer community, or null (not a first-community group, or no group of that name there yet). */
export function twinOf(chatId: string, groups: WaGroup[], twins: Map<string, string>): WaGroup | null {
  const g = groups.find(x => x.id === chatId);
  if (!g) return null;
  // The community itself (its parent group) maps straight across.
  if (twins.has(g.id)) return groups.find(x => x.id === twins.get(g.id)) ?? null;
  const parent = twins.get(g.parent);
  if (!parent) return null;
  const kin = groups.filter(x => x.parent === parent && x.id !== chatId);
  if (g.announce && g.id) {
    const ann = kin.filter(x => x.announce);
    // Announcement-only topic groups exist too (Diamonds, Watches); the community's own announcements
    // carry the community's name.
    const parentName = twinName(groups.find(x => x.id === g.parent)?.name || '');
    if (twinName(g.name) === parentName) {
      const newParentName = twinName(groups.find(x => x.id === parent)?.name || '');
      return ann.find(x => twinName(x.name) === newParentName) ?? null;
    }
  }
  return kin.find(x => twinName(x.name) === twinName(g.name)) ?? null;
}
