/**
 * A Drive folder named by its link rather than shared with the ERP — for a folder the owner can't share
 * on (TC, the archive, is Murtaza's, open to anyone with the link). The id is kept in Firestore, never in
 * the code: gemstrack-pos is a public repository. Pure, tested.
 */

/** The folder id in a Drive link (…/folders/<id>, ?id=<id>), or a bare id; null when there is none. */
export function folderIdOf(link: string): string | null {
  const s = link.trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) ?? s.match(/[?&]id=([\w-]{10,})/) ?? s.match(/^([\w-]{20,})$/);
  return m ? m[1] : null;
}
