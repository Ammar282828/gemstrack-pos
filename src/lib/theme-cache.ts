/**
 * The chosen theme, remembered locally for the next first paint.
 *
 * Settings live in Firestore and are deliberately not persisted into the
 * zustand store (migration v17 removed them), so on a cold load nothing knows
 * the theme until the network answers. The store's in-memory default is
 * 'slate', which is one of the dark palettes — so a shop on the light default
 * got a dark loading screen that flipped to white a second later, every time.
 *
 * This is a single string in its own key. It is a display hint, not state:
 * if it is wrong or missing the app still corrects itself the moment settings
 * arrive.
 */

const KEY = 'gemstrack:theme';

/**
 * The only theme that renders light. Every named theme is defined solely
 * under `.dark .theme-x` in globals.css, while `:root, .theme-default` holds
 * the light palette and has no dark counterpart.
 */
export const LIGHT_THEME = 'default';

export function readCachedTheme(): string {
  if (typeof window === 'undefined') return LIGHT_THEME;
  try { return localStorage.getItem(KEY) || LIGHT_THEME; } catch { return LIGHT_THEME; }
}

export function writeCachedTheme(theme: string | undefined | null): void {
  if (typeof window === 'undefined' || !theme) return;
  try { localStorage.setItem(KEY, theme); } catch { /* private mode — the hint is optional */ }
}
