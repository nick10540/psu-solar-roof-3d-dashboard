/**
 * useScreenBrightness.ts
 * Page-wide brightness adjustment for the venue screen.
 *
 * A 72" panel that looks right in the office is often wrong in the hall - too
 * hot under stage lighting, too dim once the room goes dark. This lets an
 * operator trim it from the dashboard instead of digging through the TV's own
 * menu, and the choice survives a reload.
 *
 * Implementation notes:
 *
 *  - The filter is applied to <html>. Any element with a `filter` becomes the
 *    containing block for fixed-position descendants, and every modal in this
 *    app is `fixed inset-0`. Putting it on the root element keeps their
 *    positioning identical to the viewport.
 *
 *  - At exactly 100% the class is REMOVED rather than set to `brightness(1)`.
 *    A filter forces the whole page through an extra full-screen compositing
 *    pass on every frame the map moves; at the default setting we pay nothing.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'mea_screen_brightness_v1';

export const BRIGHTNESS_MIN = 0.6;
export const BRIGHTNESS_MAX = 1.6;
export const BRIGHTNESS_STEP = 0.1;
export const BRIGHTNESS_DEFAULT = 1;

const ROOT_CLASS = 'brightness-adjusted';
const CSS_VAR = '--app-brightness';

/** Snap to the step grid so repeated +/- never drifts into 0.7000000000000001. */
function normalize(value: number): number {
  const clamped = Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, value));
  return Math.round(clamped * 100) / 100;
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BRIGHTNESS_DEFAULT;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? normalize(parsed) : BRIGHTNESS_DEFAULT;
  } catch {
    return BRIGHTNESS_DEFAULT;
  }
}

export interface ScreenBrightness {
  /** Current multiplier, e.g. 1.2 */
  brightness: number;
  /** Rounded percentage for display, e.g. 120 */
  percent: number;
  increase: () => void;
  decrease: () => void;
  reset: () => void;
  canIncrease: boolean;
  canDecrease: boolean;
  isDefault: boolean;
}

export function useScreenBrightness(): ScreenBrightness {
  const [brightness, setBrightness] = useState<number>(readStored);

  // Apply to the document and persist.
  useEffect(() => {
    const root = document.documentElement;

    if (brightness === BRIGHTNESS_DEFAULT) {
      root.classList.remove(ROOT_CLASS);
      root.style.removeProperty(CSS_VAR);
    } else {
      root.style.setProperty(CSS_VAR, String(brightness));
      root.classList.add(ROOT_CLASS);
    }

    try {
      localStorage.setItem(STORAGE_KEY, String(brightness));
    } catch {
      /* private mode - setting simply does not persist */
    }
  }, [brightness]);

  // Leave the document clean if this ever unmounts.
  useEffect(() => {
    return () => {
      const root = document.documentElement;
      root.classList.remove(ROOT_CLASS);
      root.style.removeProperty(CSS_VAR);
    };
  }, []);

  const increase = useCallback(() => {
    setBrightness((prev) => normalize(prev + BRIGHTNESS_STEP));
  }, []);

  const decrease = useCallback(() => {
    setBrightness((prev) => normalize(prev - BRIGHTNESS_STEP));
  }, []);

  const reset = useCallback(() => setBrightness(BRIGHTNESS_DEFAULT), []);

  return {
    brightness,
    percent: Math.round(brightness * 100),
    increase,
    decrease,
    reset,
    canIncrease: brightness < BRIGHTNESS_MAX,
    canDecrease: brightness > BRIGHTNESS_MIN,
    isDefault: brightness === BRIGHTNESS_DEFAULT,
  };
}
