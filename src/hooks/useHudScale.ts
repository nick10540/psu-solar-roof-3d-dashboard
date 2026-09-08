/**
 * useHudScale.ts
 * React binding for the responsive HUD scale (see config/hudScale.ts).
 *
 * Notes:
 *  - Both events are needed. F11 and kiosk mode only ever fire `resize`; the
 *    header bar's fullscreen button fires `fullscreenchange`, and on that path
 *    `innerHeight` has not caught up yet at event time - which is why the read
 *    is deferred to a frame.
 *  - State holds the ROUNDED scale, so a slow drag-resize re-renders the map
 *    subtree only on the few pixels where the factor actually changes value.
 *  - rAF-coalesced: `resize` fires continuously while a window is dragged, and
 *    every change here re-renders Solar3DViewer and re-lays-out five cards.
 */

import { useEffect, useState } from 'react';
import { computeHudScale } from '../config/hudScale';

export function useHudScale(): number {
  const [scale, setScale] = useState<number>(computeHudScale);

  useEffect(() => {
    let raf = 0;

    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = computeHudScale();
        setScale((prev) => (prev === next ? prev : next));
      });
    };

    window.addEventListener('resize', sync);
    document.addEventListener('fullscreenchange', sync);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sync);
      document.removeEventListener('fullscreenchange', sync);
    };
  }, []);

  return scale;
}
