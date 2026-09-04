/**
 * mapConfig.ts
 * Single source of truth for the MapLibre 3D satellite map.
 *
 * Design goals (72" TV, unattended all-day operation):
 *  1. Southern Thailand is pre-warmed into the tile cache, so the view the
 *     audience sees is already local before the map is ever touched.
 *  2. One unified style holding every layer -> switching basemap toggles
 *     visibility instead of calling setStyle(), so no tiles are re-downloaded.
 *  3. Conservative pitch/zoom envelope -> bounded tile count per frame, and the
 *     horizon never enters the frame.
 *  4. Sky + background beneath everything, so the frame is never bare.
 */

import type { StyleSpecification } from 'maplibre-gl';

// ---------------------------------------------------------------------------
// Geographic envelopes
//
// These boxes describe what is DOWNLOADED AHEAD OF TIME and where the CAMERA
// may go. They are not a clip region for the imagery - see the note below on
// why the sources carry no `bounds`.
//
// The frustum is far larger than the region. At zoom 7.6 a 1920px-wide viewport
// spans ~14 deg of longitude even flat on; tilt it and the ground visible
// toward the horizon stretches further again by an order of magnitude.
// ---------------------------------------------------------------------------

/**
 * Detailed pre-warm area: ภาคใต้ของประเทศไทย (Southern Thailand).
 * Sites span lng 98.39 -> 101.25, lat 6.87 -> 9.14.
 */
export const SOUTH_TH_PREWARM_BOUNDS: [number, number, number, number] = [96.8, 4.8, 103.0, 12.0];

/**
 * Coarse surround pre-warmed at low zoom so the far field is never bare on a
 * cold start.
 *
 * Sized from the measured worst case rather than guessed: sweeping the camera
 * through every bearing at MAX_PITCH from REGIONAL_CENTER, `map.getBounds()`
 * reaches lng 89.6 -> 111.3 and lat -3.5 -> 20.6. This box adds ~5 deg of
 * margin on each side to absorb panning inside MAP_MAX_BOUNDS.
 *
 * (For contrast, the first attempt at a tile envelope was 96.8 -> 103.0 /
 * 4.8 -> 12.0 - about a third of what the frame actually shows. The rest was
 * drawn empty, which is exactly what the black wedges were.)
 */
export const SURROUND_PREWARM_BOUNDS: [number, number, number, number] = [84.0, -9.0, 117.0, 26.0];

/**
 * NOTE: the raster sources deliberately carry NO `bounds`.
 *
 * A bounded envelope cannot work at high pitch. MapLibre projects onto a flat
 * Mercator plane, so the horizon appears once `pitch + fov/2 >= 90 deg`; with
 * the default 36.9 deg fov that is pitch 71.6 deg. At pitch 70 the top of the
 * frame is therefore looking ~1.6 deg below the horizon, where ground distance
 * runs away toward infinity - tens of thousands of km. No box covers that, and
 * whatever the box misses is drawn as empty: the black wedges seen on rotate.
 *
 * Request volume is controlled by the mechanisms that actually govern it:
 * MAP_MAX_BOUNDS fences the camera, MAX_ZOOM caps detail, `refreshExpiredTiles:
 * false` stops idle revalidation, and the tile cache absorbs revisits. `bounds`
 * was never what kept the count down - it only ever punched holes in the view.
 */

/**
 * Camera clamp. Deliberately much larger than the viewport at MIN_ZOOM:
 * when maxBounds is smaller than the visible frame MapLibre locks panning and
 * snaps the camera back, which reads to an operator as the map "fighting" them.
 * This still keeps the kiosk inside Asia; the reset button returns home.
 */
export const MAP_MAX_BOUNDS: [[number, number], [number, number]] = [
  [70.0, -20.0], // south-west
  [135.0, 38.0], // north-east
];

/**
 * Default camera target.
 *
 * NOT the geometric centroid of the five sites — it is the framing the
 * operators picked on the 72" panel and asked to keep. Sitting north-east of
 * the centroid pushes the pins down and left in frame, which is what stops
 * their cards piling onto each other at this zoom.
 */
export const REGIONAL_CENTER: [number, number] = [100.36, 9.153];

// ---------------------------------------------------------------------------
// Camera envelope
// ---------------------------------------------------------------------------
export const DEFAULT_ZOOM = 7.47;
/** Raised from 6: at z6 a wide viewport spans ~42 deg, far more than the region needs. */
export const MIN_ZOOM = 6.5;
export const MAX_ZOOM = 17;
export const SITE_FLY_ZOOM = 14.5;

export const DEFAULT_PITCH = 60;
/**
 * Hard cap at 65 deg (was 85, then 70).
 *
 * The flat-plane horizon appears at pitch = 90 - fov/2 = 71.6 deg. Sitting at
 * 70 put the top of the frame just under that line, where ground distance runs
 * away toward infinity: maximum tile count, maximum distortion, and a bare
 * strip wherever imagery ran out. 65 keeps the horizon off screen entirely
 * while still reading as a strong oblique 3D view.
 */
export const MAX_PITCH = 65;
/** Read off the live map after the operators framed the shot by hand. */
export const DEFAULT_BEARING = 17.3;

/**
 * Tile pyramid depth served by the raster sources.
 *
 * SOURCE_MIN_ZOOM goes all the way to 0. Distant ground is drawn from very
 * coarse tiles; with a floor of z5 MapLibre had nothing to draw out there and
 * left it bare. z0 is a single tile for the whole world, z1 is four - the far
 * field costs a handful of requests, once, and then lives in the cache.
 */
export const SOURCE_MIN_ZOOM = 0;
export const SOURCE_MAX_ZOOM = 17;

/** Auto-orbit speed, degrees per second (frame-rate independent). */
export const ORBIT_DEG_PER_SEC = 4.5;

/** Minimum gap between React state syncs of the bearing/pitch badges, in ms. */
export const CAMERA_BADGE_THROTTLE_MS = 250;

/**
 * Quiet time after the last `moveend` before the camera is written to storage.
 *
 * A scroll-wheel zoom fires one `moveend` per tick; this coalesces the whole
 * gesture into a single write. Long enough to catch the tail of a flick, short
 * enough that a reload moments after a move still keeps it.
 */
export const CAMERA_SAVE_DEBOUNCE_MS = 700;

/**
 * Longest the write above may be deferred while movement keeps coming.
 *
 * Auto-orbit rewrites the bearing every frame, and every one of those fires
 * `moveend` - so a pure debounce would reset forever and never checkpoint a
 * pan made while the board is orbiting. This is the ceiling that breaks that
 * standoff.
 */
export const CAMERA_SAVE_MAX_WAIT_MS = 4000;

// ---------------------------------------------------------------------------
// Tile endpoints
// ---------------------------------------------------------------------------
export const ESRI_IMAGERY_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

export const ESRI_BOUNDARIES_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export const CARTO_DARK_TILE_URL =
  'https://a.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png';

/** Hosts the tile Service Worker is allowed to cache. Keep in sync with public/sw-tiles.js. */
export const CACHEABLE_TILE_HOSTS = [
  'server.arcgisonline.com',
  'services.arcgisonline.com',
  'a.basemaps.cartocdn.com',
  'b.basemaps.cartocdn.com',
  'c.basemaps.cartocdn.com',
];

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------
export type SatelliteLayerStyle = 'esri-satellite' | 'hybrid' | 'dark';

export const LAYER_IDS = {
  /** Bottom-most fill. Anything imagery does not cover reads as deep sea, not as a hole. */
  base: 'base-background',
  cartoDark: 'carto-dark-layer',
  esriSatellite: 'esri-satellite-layer',
  esriBoundaries: 'esri-boundaries-layer',
} as const;

/**
 * Sky above the horizon.
 *
 * At pitch 60-70 a large slice of the frame sits above the earth entirely,
 * where by definition there are no tiles. Without a sky that slice is painted
 * with the canvas background - the "black edge" seen while rotating. These
 * values give a dark atmospheric glow that matches the slate-950 dashboard
 * chrome and reads as an intentional Google Earth horizon.
 */
export const SKY_SPEC = {
  'sky-color': '#050b18',
  'horizon-color': '#1e4a6d',
  'fog-color': '#0a1626',
  'sky-horizon-blend': 0.55,
  'horizon-fog-blend': 0.5,
} as const;

/** Deep-sea tone used by the background layer. */
export const BASE_BACKGROUND_COLOR = '#071018';

/**
 * The link line: one arc through all five site pins, in pin order, drawn on
 * once as the intro hands over and then left standing.
 *
 * Deliberately NOT listed in LAYER_VISIBILITY below. The link belongs to the
 * dashboard rather than to any one basemap, so it survives a switch between
 * satellite, hybrid and dark instead of being toggled with them.
 *
 *  - `curvature` is the sideways bulge of each arc as a fraction of the
 *    segment's own length. Past ~0.25 the arcs start crossing the coastline
 *    they are meant to follow.
 *  - `stepsPerSegment` is how finely each arc is sampled. 28 keeps a 300 km
 *    span smooth at zoom 17 and still leaves the whole line at ~110 points,
 *    which is nothing to re-upload.
 *  - `drawMs` is the one-shot reveal. Long enough to read as deliberate on a
 *    72" screen, short enough not to hold the room.
 */
export const SITE_LINK_SPEC = {
  sourceId: 'mea-site-link-source',
  glowLayerId: 'mea-site-link-glow',
  lineLayerId: 'mea-site-link-line',
  curvature: 0.16,
  stepsPerSegment: 28,
  drawMs: 2600,
  /** The line once it has been drawn. */
  bodyColor: 'rgba(56,189,248,0.9)',
  /** The bright tip that leads the reveal, and the flow pulses after it. */
  headColor: 'rgba(224,247,255,1)',
  /** Wide, soft pass underneath, so the line reads over bright rooftops too. */
  glowColor: 'rgba(14,165,233,0.4)',

  // --- The flow, once the line is drawn -----------------------------------
  /**
   * Master switch for the pulses that run สุราษฎร์ธานี -> ปัตตานี for ever.
   *
   * READ THIS BEFORE LEAVING IT ON. Without it the drawn line is free: a flat
   * colour ramp that MapLibre uploads once and never touches again, and the
   * map goes back to repainting only when the camera moves. With it, every
   * `flowFrameMs` re-uploads two gradient ramps and dirties the map - which on
   * an idle board means repainting the whole WebGL scene, 4K raster tiles
   * included, for as long as the dashboard is up.
   *
   * That is a real and permanent cost on the venue machine, accepted here
   * because a ceremony screen is meant to look alive. Turn it off for a panel
   * that has to share a GPU, or that will run for days.
   */
  flow: true,
  /** One pulse's trip along the whole chain, pin 1 to pin 5. */
  flowMs: 4200,
  /**
   * Pulses in flight at once, spread evenly along the line.
   *
   * One reads as a lonely dot with a long empty wait; two keeps something
   * visible on the line at all times without it looking like a chase light.
   */
  flowPulses: 2,
  /** Half-width of a pulse, as a fraction of the line's length. */
  flowPulseWidth: 0.06,
  /**
   * Minimum gap between flow frames - ~30fps.
   *
   * The pulses cross the screen over four seconds; nothing about that needs
   * 60fps, and halving the frame rate halves everything the paragraph above
   * is warning about.
   */
  flowFrameMs: 33,
} as const;

/**
 * Which layers are visible per basemap mode.
 * Hidden layers cost nothing: MapLibre does not request tiles for
 * layers whose `visibility` is `none`, but it keeps the tiles it already
 * has in the source cache -- so toggling back is instant and free.
 */
export const LAYER_VISIBILITY: Record<SatelliteLayerStyle, Record<string, 'visible' | 'none'>> = {
  'esri-satellite': {
    [LAYER_IDS.cartoDark]: 'none',
    [LAYER_IDS.esriSatellite]: 'visible',
    [LAYER_IDS.esriBoundaries]: 'none',
  },
  hybrid: {
    [LAYER_IDS.cartoDark]: 'none',
    [LAYER_IDS.esriSatellite]: 'visible',
    [LAYER_IDS.esriBoundaries]: 'visible',
  },
  dark: {
    [LAYER_IDS.cartoDark]: 'visible',
    [LAYER_IDS.esriSatellite]: 'none',
    [LAYER_IDS.esriBoundaries]: 'none',
  },
};
// The background layer is never toggled - it stays under every mode.

/**
 * One style containing every source + layer.
 * Built once at map construction and never replaced -- setStyle() is never called,
 * which is what previously forced a full tile re-download on each basemap switch.
 */
export function buildUnifiedMapStyle(): StyleSpecification {
  return {
    version: 8,
    sky: { ...SKY_SPEC },
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: [CARTO_DARK_TILE_URL],
        tileSize: 256,
        minzoom: SOURCE_MIN_ZOOM,
        maxzoom: SOURCE_MAX_ZOOM,
        attribution: '© CARTO, OpenStreetMap contributors',
      },
      'esri-satellite': {
        type: 'raster',
        tiles: [ESRI_IMAGERY_TILE_URL],
        tileSize: 256,
        minzoom: SOURCE_MIN_ZOOM,
        maxzoom: SOURCE_MAX_ZOOM,
        attribution: '© Esri World Imagery, Maxar, Earthstar Geographics',
      },
      'esri-boundaries': {
        type: 'raster',
        tiles: [ESRI_BOUNDARIES_TILE_URL],
        tileSize: 256,
        minzoom: SOURCE_MIN_ZOOM,
        maxzoom: SOURCE_MAX_ZOOM,
      },
    },
    layers: [
      {
        id: LAYER_IDS.base,
        type: 'background',
        paint: { 'background-color': BASE_BACKGROUND_COLOR },
      },
      {
        id: LAYER_IDS.cartoDark,
        type: 'raster',
        source: 'carto-dark',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1.0, 'raster-fade-duration': 0 },
      },
      {
        id: LAYER_IDS.esriSatellite,
        type: 'raster',
        source: 'esri-satellite',
        layout: { visibility: 'visible' },
        paint: { 'raster-opacity': 1.0, 'raster-fade-duration': 0 },
      },
      {
        id: LAYER_IDS.esriBoundaries,
        type: 'raster',
        source: 'esri-boundaries',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 0.7, 'raster-fade-duration': 0 },
      },
    ],
  };
}
