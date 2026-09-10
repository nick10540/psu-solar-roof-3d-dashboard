/**
 * useHudScaleTrim.ts
 * The operator's manual +/- on top of the automatic HUD scale (see
 * config/hudScale.ts) - "ปรับ เพิ่ม-ลด scale เผื่อไป adjust หน้างาน", the knob
 * to nudge the board size while standing at the venue.
 *
 * A MODULE-LEVEL STORE, NOT A PLAIN useState
 * -------------------------------------------
 * useScreenBrightness (the closest analogue) gets away with a plain
 * `useState` because it has exactly one mounted consumer, BrightnessControl.
 * This value has two, by construction: the drawer widget that lets an
 * operator change it (HudScaleControl.tsx), and useHudScale.ts, which reads it
 * on every viewport change to compute the one number the map and the HUD
 * overlays actually apply. Two independent `useState`s would desync on the
 * first tap. So the value lives in module scope with a subscribe/notify pair,
 * the same shape this codebase already uses twice for a value more than one
 * tree needs to agree on - `subscribeToClock`/`getClockNow` (UpdatedAgo.tsx)
 * and `subscribeIntroFinished`/`hasIntroFinished` (introHandoff.ts).
 *
 * Everything else - the numeric contract, the persistence shape, the
 * clamp-not-reset behaviour on an out-of-range stored value - mirrors
 * useScreenBrightness.ts deliberately, so the two controls behave identically
 * to someone who has already learned one of them.
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
  HUD_MANUAL_SCALE_DEFAULT,
  HUD_MANUAL_SCALE_MAX,
  HUD_MANUAL_SCALE_MIN,
  HUD_MANUAL_SCALE_STEP,
} from '../config/hudScale';

const STORAGE_KEY = 'mea_hud_scale_v1';

/** Snap to the step grid so repeated +/- never drifts into 0.9000000000000001. */
function normalize(value: number): number {
  const clamped = Math.min(HUD_MANUAL_SCALE_MAX, Math.max(HUD_MANUAL_SCALE_MIN, value));
  const stepped = Math.round(clamped / HUD_MANUAL_SCALE_STEP) * HUD_MANUAL_SCALE_STEP;
  return Math.round(stepped * 100) / 100;
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return HUD_MANUAL_SCALE_DEFAULT;
    const parsed = Number(raw);
    // `> 0` as well as `isFinite`: a stored '0' or a blank string (Number('')
    // is 0) must not survive as a value that then clamps to the floor with no
    // visible cause - the same guard siteMultiplier.ts applies to a stray 0.
    return Number.isFinite(parsed) && parsed > 0 ? normalize(parsed) : HUD_MANUAL_SCALE_DEFAULT;
  } catch {
    return HUD_MANUAL_SCALE_DEFAULT;
  }
}

let trim = readStored();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** The trim as it is right now, for a non-React reader (useHudScale.ts). */
export function getHudScaleTrim(): number {
  return trim;
}

/** Subscribe to trim changes. Returns the unsubscribe. */
export function subscribeHudScaleTrim(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function applyAndPersist(next: number): void {
  const normalized = normalize(next);
  if (normalized === trim) return;
  trim = normalized;

  try {
    // At exactly DEFAULT the key is removed rather than written, mirroring
    // useScreenBrightness.ts - "never touched" and "deliberately set back to
    // automatic" are then the same state on disk, so a fresh kiosk profile
    // reads identically to a reset one.
    if (trim === HUD_MANUAL_SCALE_DEFAULT) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(trim));
    }
  } catch {
    /* private mode - setting simply does not persist */
  }

  notify();
}

/**
 * Forget the saved trim; the next load opens at the automatic scale.
 * Mirrors clearMapCamera() - the last-resort escape hatch for a kiosk nobody
 * can reach by touch (a corrupt stored value, or a drawer that fails to
 * render): `localStorage.removeItem('mea_hud_scale_v1')` then reload.
 */
export function clearHudScaleTrim(): void {
  applyAndPersist(HUD_MANUAL_SCALE_DEFAULT);
}

export interface HudScaleTrim {
  /** Current multiplier, e.g. 1.15 */
  trim: number;
  /** Rounded percentage for display, e.g. 115 */
  percent: number;
  increase: () => void;
  decrease: () => void;
  reset: () => void;
  canIncrease: boolean;
  canDecrease: boolean;
  isDefault: boolean;
}

/** React binding for the shared trim store. */
export function useHudScaleTrim(): HudScaleTrim {
  const value = useSyncExternalStore(
    subscribeHudScaleTrim,
    getHudScaleTrim,
    () => HUD_MANUAL_SCALE_DEFAULT
  );

  const increase = useCallback(() => applyAndPersist(value + HUD_MANUAL_SCALE_STEP), [value]);
  const decrease = useCallback(() => applyAndPersist(value - HUD_MANUAL_SCALE_STEP), [value]);
  const reset = useCallback(() => applyAndPersist(HUD_MANUAL_SCALE_DEFAULT), []);

  return {
    trim: value,
    percent: Math.round(value * 100),
    increase,
    decrease,
    reset,
    canIncrease: value < HUD_MANUAL_SCALE_MAX,
    canDecrease: value > HUD_MANUAL_SCALE_MIN,
    isDefault: value === HUD_MANUAL_SCALE_DEFAULT,
  };
}
