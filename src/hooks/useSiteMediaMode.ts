/**
 * useSiteMediaMode.ts
 * The board-wide switch between a site's looping CLIP and its still PHOTO -
 * "โหมดแสดงผลด้วยรูปภาพแทนวิดีโอ". One setting, applied to the pin cards on
 * the map and to every site subpage at once. The two banner sets it chooses
 * between live in config/siteMedia.ts.
 *
 * A MODULE-LEVEL STORE, NOT A PLAIN useState
 * ------------------------------------------
 * Same reasoning as useHudScaleTrim.ts, and deliberately the same shape so
 * someone who has read one has read both. The single control sits in the map's
 * right-edge drawer, while the readers are elsewhere entirely: SiteDetailSubpage
 * on another screen, and Solar3DViewer's marker builder, which is not React at
 * all - it writes marker DOM by hand. Independent `useState`s would desync on
 * the first tap.
 *
 * Persistence mirrors useScreenBrightness/useHudScaleTrim too: at the default
 * the key is REMOVED rather than written, so "never touched" and "switched
 * back to video" are the same state on disk and a fresh kiosk profile reads
 * identically to a reset one.
 */

import { useSyncExternalStore } from 'react';
import { SITE_MEDIA_MODE_DEFAULT, SiteMediaMode } from '../config/siteMedia';

const STORAGE_KEY = 'mea_site_media_mode_v1';

function readStored(): SiteMediaMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Anything else on disk - an older value, a hand-edit, a truncated write -
    // falls back to the default rather than blanking every banner on the board.
    return raw === 'picture' || raw === 'video' ? raw : SITE_MEDIA_MODE_DEFAULT;
  } catch {
    return SITE_MEDIA_MODE_DEFAULT;
  }
}

let mode: SiteMediaMode = readStored();
const listeners = new Set<() => void>();

/** The mode as it is right now, for a non-React reader. */
export function getSiteMediaMode(): SiteMediaMode {
  return mode;
}

/** Subscribe to mode changes. Returns the unsubscribe. */
export function subscribeSiteMediaMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSiteMediaMode(next: SiteMediaMode): void {
  if (next === mode) return;
  mode = next;

  try {
    if (mode === SITE_MEDIA_MODE_DEFAULT) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    /* private mode - the setting simply does not persist */
  }

  listeners.forEach((listener) => listener());
}

/**
 * Forget the saved mode; the next load opens on the clips.
 * Mirrors clearHudScaleTrim() - the escape hatch for a kiosk nobody can reach
 * by touch: `localStorage.removeItem('mea_site_media_mode_v1')` then reload.
 */
export function clearSiteMediaMode(): void {
  setSiteMediaMode(SITE_MEDIA_MODE_DEFAULT);
}

/** React binding for the shared mode store. */
export function useSiteMediaMode(): SiteMediaMode {
  return useSyncExternalStore(
    subscribeSiteMediaMode,
    getSiteMediaMode,
    () => SITE_MEDIA_MODE_DEFAULT
  );
}
