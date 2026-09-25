/** Lettering colours for a story. Shared by the page (drawing) and the AI route (choosing). */

export interface Palette { id: string; label: string; headline: string; body: string; dark: boolean }

/**
 * Pairs taken off the shop's stories: forest green over cream, emerald over
 * cream with a warm brown line, caramel with a navy line, gold over dark
 * green, and plain white for dark photographs.
 */
export const PALETTES: Palette[] = [
  { id: 'forest',  label: 'Forest',  headline: '#1F4A2C', body: '#7A5A35', dark: false },
  { id: 'emerald', label: 'Emerald', headline: '#2E9E57', body: '#7A4E4E', dark: false },
  { id: 'caramel', label: 'Caramel', headline: '#C07A3E', body: '#2C3480', dark: false },
  { id: 'gold',    label: 'Gold',    headline: '#C9973F', body: '#F4EFE6', dark: true },
  { id: 'white',   label: 'White',   headline: '#FFFFFF', body: '#FFFFFF', dark: true },
];
