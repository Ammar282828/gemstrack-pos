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
 * The only theme that renders light. <html> always carries `.dark`; the light
 * palette is applied by `.theme-default` on <body> overriding it. Any other
 * value — 'taheri', or one of the retired colour options — is simply the absence
 * of that override, so the `.dark` palette shows through.
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

// ── This device's own choice ───────────────────────────────────────────────
// The mode in Settings is the SHOP's, kept in Firestore and live on every screen,
// so one person switching it flipped everybody's (the owner, 2026-09-25: "switching
// is buggy"). The sun/moon in the top bar sets this device's own mode instead, and
// a device that has never chosen follows the shop's.

const DEVICE_KEY = 'gemstrack:theme-device';
/** Fired on window when this device's mode changes, so the layout re-renders. */
export const DEVICE_THEME_EVENT = 'gemstrack:theme-device';

export function readDeviceTheme(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(DEVICE_KEY); } catch { return null; }
}

/** Set (or with null, clear) this device's mode, and tell the layout. */
export function writeDeviceTheme(theme: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (theme) localStorage.setItem(DEVICE_KEY, theme); else localStorage.removeItem(DEVICE_KEY);
    if (theme) localStorage.setItem(KEY, theme);
  } catch { /* private mode — it still switches for this visit */ }
  window.dispatchEvent(new CustomEvent(DEVICE_THEME_EVENT, { detail: theme }));
}

/**
 * Put <html> in the mode being shown: `.dark` only on the dark palette (it used to be
 * there always, so every `dark:` style — pale text, the charts' dark colours — showed
 * in light mode too), `color-scheme` for scrollbars and date pickers, and the first-
 * paint class, whose background showed through at the edges after a switch.
 */
export function applyThemeToDocument(theme: string): void {
  if (typeof document === 'undefined') return;
  const light = theme === LIGHT_THEME;
  const html = document.documentElement;
  html.classList.toggle('dark', !light);
  html.classList.toggle('boot-light', light);
  html.classList.toggle('boot-dark', !light);
}
