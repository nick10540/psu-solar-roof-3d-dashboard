/**
 * mapCameraService.ts
 * Remembers where the map was pointing, in LocalStorage
 * ('psu_solar_map_camera_v1').
 *
 * Two reloads make this worth having, and neither is a person pressing F5:
 *
 *  - useLongRunGuard reloads the page unattended under heap pressure. Without
 *    this the board would come back on the opening wide shot, which during an
 *    event means whatever the operator had framed is silently thrown away.
 *  - Solar3DViewer rebuilds the whole map after an unrecoverable WebGL context
 *    loss. Same problem, no page reload involved - which is why the viewer
 *    flushes the camera in its teardown and reads it back on init.
 *
 * The escape hatch is the control drawer's "กลับมุมมองเริ่มต้น" button: it
 * eases back to the opening framing, whose `moveend` saves those defaults
 * like any other move. Nothing extra needed to forget a saved view.
 *
 * Values are validated on the way in, never trusted. A saved zoom outside the
 * map's current limits is clamped (the config can legitimately change under a
 * stored value), but a centre outside the tile envelope is rejected outright -
 * that is corrupt or foreign data, and clamping it would only produce a
 * confident view of the wrong place.
 */

import { MAP_MAX_BOUNDS, MAX_PITCH, MAX_ZOOM, MIN_ZOOM } from '../config/mapConfig';

const STORAGE_KEY_MAP_CAMERA = 'psu_solar_map_camera_v1';

export interface MapCameraState {
  /** `[lng, lat]`, the order MapLibre's `center` option takes. */
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

interface StoredMapCamera extends MapCameraState {
  savedAt?: string;
}

const [[MIN_LNG, MIN_LAT], [MAX_LNG, MAX_LAT]] = MAP_MAX_BOUNDS;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Rounds to the precision actually worth storing, and wraps the bearing.
 *
 * Not cosmetic: the viewer compares a fresh reading against the last one it
 * wrote to decide whether to write at all, and that comparison is only stable
 * if both sides have been through here. Un-rounded, the float noise at the
 * tail of a settled camera would look like movement and write on every event.
 *
 * 6 decimal places of longitude is ~10 cm - far below one screen pixel of a
 * satellite tile.
 */
export function normaliseCamera(camera: MapCameraState): MapCameraState {
  return {
    center: [Number(camera.center[0].toFixed(6)), Number(camera.center[1].toFixed(6))],
    zoom: Number(camera.zoom.toFixed(2)),
    pitch: Number(camera.pitch.toFixed(1)),
    bearing: Number((((camera.bearing % 360) + 360) % 360).toFixed(1)),
  };
}

/**
 * The saved camera, or null when there is nothing usable stored - which is the
 * caller's cue to open on the dashboard's own defaults.
 */
export function loadMapCamera(): MapCameraState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MAP_CAMERA);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredMapCamera>;
    const center = parsed.center;

    if (
      !Array.isArray(center) ||
      center.length !== 2 ||
      !Number.isFinite(center[0]) ||
      !Number.isFinite(center[1]) ||
      !Number.isFinite(parsed.zoom) ||
      !Number.isFinite(parsed.pitch) ||
      !Number.isFinite(parsed.bearing)
    ) {
      return null;
    }

    // Outside the tile envelope the map is built with there is no view worth
    // restoring, only a grey rectangle where imagery was never fetched.
    if (
      center[0] < MIN_LNG ||
      center[0] > MAX_LNG ||
      center[1] < MIN_LAT ||
      center[1] > MAX_LAT
    ) {
      console.warn('[mapCamera] Stored centre is outside the map bounds - ignoring it.');
      return null;
    }

    return normaliseCamera({
      center: [center[0], center[1]],
      zoom: clamp(parsed.zoom as number, MIN_ZOOM, MAX_ZOOM),
      pitch: clamp(parsed.pitch as number, 0, MAX_PITCH),
      bearing: parsed.bearing as number,
    });
  } catch (err) {
    console.warn('[mapCamera] Failed to load the saved camera:', err);
    return null;
  }
}

/**
 * Overwrites the stored camera.
 *
 * Callers are expected to have decided the camera actually moved: this runs on
 * `moveend`, and LocalStorage is synchronous main-thread work on a machine
 * that is also drawing a 3D map.
 */
export function saveMapCamera(camera: MapCameraState): void {
  try {
    const payload: StoredMapCamera = {
      ...normaliseCamera(camera),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_MAP_CAMERA, JSON.stringify(payload));
  } catch (err) {
    // A full or blocked store must never break panning the map.
    console.warn('[mapCamera] Failed to save the camera:', err);
  }
}

/** Forget the saved view; the next load opens on the dashboard's defaults. */
export function clearMapCamera(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_MAP_CAMERA);
  } catch (err) {
    console.warn('[mapCamera] Failed to clear the saved camera:', err);
  }
}
