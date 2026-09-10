/**
 * useHudScale.ts
 * React binding for the effective HUD scale: the automatic viewport fit
 * (config/hudScale.ts) composed with the operator's manual trim
 * (hooks/useHudScaleTrim.ts) into the one number the map and every HUD
 * overlay actually apply.
 *
 * Notes:
 *  - Three sources can change the value, and all three are watched: `resize`
 *    (F11, kiosk mode, and an ordinary window drag all fire this),
 *    `fullscreenchange` (the header bar's fullscreen button - on this path
 *    `innerHeight` has not caught up yet at event time, which is why the read
 *    is deferred to a frame), and the trim store (an operator tapping +/- in
 *    the map's control drawer).
 *  - State holds the ROUNDED scale, so a slow drag-resize re-renders the map
 *    subtree only on the few pixels where the factor actually changes value.
 *  - rAF-coalesced: `resize` fires continuously while a window is dragged, and
 *    every change here re-renders Solar3DViewer and re-lays-out five cards.
 */

import { useEffect, useState } from 'react';
import { computeEffectiveHudScale } from '../config/hudScale';
import { getHudScaleTrim, subscribeHudScaleTrim } from './useHudScaleTrim';

function computeScale(): number {
  return computeEffectiveHudScale(getHudScaleTrim());
}

export function useHudScale(): number {
  const [scale, setScale] = useState<number>(computeScale);

  useEffect(() => {
    let raf = 0;

    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = computeScale();
        setScale((prev) => (prev === next ? prev : next));
      });
    };

    window.addEventListener('resize', sync);
    document.addEventListener('fullscreenchange', sync);
    // The trim can change with no resize/fullscreenchange event in sight - an
    // operator tapping +/- in the drawer - so it needs its own subscription
    // rather than riding one of the two above.
    const unsubscribeTrim = subscribeHudScaleTrim(sync);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sync);
      document.removeEventListener('fullscreenchange', sync);
      unsubscribeTrim();
    };
  }, []);

  return scale;
}
