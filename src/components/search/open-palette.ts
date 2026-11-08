/**
 * Open the command palette from anywhere (the sidebar's Search entry uses this). Kept apart from
 * command-palette.tsx so the shell can load the palette itself lazily, off the first paint.
 */
export const OPEN_EVENT = 'command-palette:open';
export function openCommandPalette(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}
