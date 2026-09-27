'use client';

/**
 * The fonts and marks the square editor draws a website photograph with — the
 * house site's own mark (STORE_SITE_MARK_SVG) and the t where there is one —
 * loaded as Post a Piece loads its own: layouts measure the marks when they place
 * them. For Website → Edit a piece and Posts → From the website; `enabled` holds
 * it back until an editor is first wanted.
 */

import { useEffect, useRef, useState } from 'react';
import { STORE_MONOGRAM_SVG, STORE_SITE_MARK_SVG } from '@/lib/store-config';
import { loadImage, loadStampFont } from '@/lib/social/story';
import type { Assets } from '@/lib/social/editor';
import { FONTS } from './fonts';

export function useSiteAssets(enabled = true): { marks: Assets['marks']; ready: boolean } {
  const [marks, setMarks] = useState<Assets['marks']>({});
  const [ready, setReady] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    Promise.all([
      document.fonts.load(`800 100px ${FONTS.headline}`), document.fonts.load(`300 40px ${FONTS.body}`),
      document.fonts.load(`400 40px ${FONTS.body}`), document.fonts.load(`500 40px ${FONTS.serif}`), document.fonts.load(`italic 400 40px ${FONTS.serif}`),
      loadStampFont(),
      Promise.all([
        loadImage(STORE_SITE_MARK_SVG).then(img => ({ wordmark: img })).catch(() => ({})),
        STORE_MONOGRAM_SVG ? loadImage(STORE_MONOGRAM_SVG).then(img => ({ t: img })).catch(() => ({})) : Promise.resolve({}),
      ]).then(([w, t]) => setMarks({ ...w, ...t })),
    ]).catch(() => undefined).then(() => setReady(true));
  }, [enabled]);
  return { marks, ready };
}
