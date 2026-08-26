/**
 * tileCacheService.ts
 * Registers the tile Service Worker and pre-warms the Southern Thailand
 * tile pyramid so the opening ceremony starts from a fully cached basemap.
 *
 * After a successful warm-up the dashboard serves the entire regional view
 * from disk: no basemap network traffic for the rest of the day.
 */

import {
  SOUTH_TH_PREWARM_BOUNDS,
  SURROUND_PREWARM_BOUNDS,
  ESRI_IMAGERY_TILE_URL,
  ESRI_BOUNDARIES_TILE_URL,
} from '../config/mapConfig';

const SW_URL = '/sw-tiles.js';
const PREWARM_STAMP_KEY = 'mea_tiles_prewarmed_v2';
const PREWARM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-warm at most once a week

/** MUST match CACHE_NAME in public/sw-tiles.js. */
export const TILE_CACHE_NAME = 'mea-map-tiles-v2';

/** Detailed zoom levels for Southern Thailand (the default view sits at z7.6). */
export const PREWARM_MIN_ZOOM = 6;
export const PREWARM_MAX_ZOOM = 9;

/**
 * Coarse zoom levels for the wider surround.
 *
 * At pitch 60-70 the ground near the horizon is drawn from very low zoom
 * tiles that sit far outside Southern Thailand. Without these the far field
 * is empty on a cold start - the black wedges seen while rotating. z2-z6 over
 * the surround box is ~100 tiles, a one-off cost of a few MB.
 */
export const SURROUND_MIN_ZOOM = 2;
export const SURROUND_MAX_ZOOM = 6;

/** Parallel prefetch requests. Kept low so warm-up never competes with the live map. */
const PREWARM_CONCURRENCY = 4;

export interface PrewarmResult {
  requested: number;
  ok: number;
  failed: number;
  skipped: boolean;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Slippy-map tile maths
// ---------------------------------------------------------------------------
function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

/** Every {z,x,y} inside the Southern Thailand envelope for the given zoom range. */
export function enumerateRegionTiles(
  bounds: [number, number, number, number] = SOUTH_TH_PREWARM_BOUNDS,
  minZoom = PREWARM_MIN_ZOOM,
  maxZoom = PREWARM_MAX_ZOOM
): Array<{ z: number; x: number; y: number }> {
  const [west, south, east, north] = bounds;
  const tiles: Array<{ z: number; x: number; y: number }> = [];

  for (let z = minZoom; z <= maxZoom; z++) {
    const xMin = lngToTileX(west, z);
    const xMax = lngToTileX(east, z);
    const yMin = latToTileY(north, z); // north => smaller y
    const yMax = latToTileY(south, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

function fillTemplate(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

// ---------------------------------------------------------------------------
// Service Worker registration
// ---------------------------------------------------------------------------
export async function registerTileCacheWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    console.info('[tileCache] Service Worker unavailable - falling back to HTTP cache only.');
    return null;
  }

  // One retry: the first attempt can lose a race with a still-warming dev
  // server or a slow first paint, and the whole tile cache would then be off
  // for the rest of the session over a transient script-fetch failure.
  const attempts = 2;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });

      // Wait until a worker is actually controlling the page, otherwise the
      // pre-warm fetches would bypass the cache entirely.
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          const timeout = window.setTimeout(resolve, 4000);
          navigator.serviceWorker.addEventListener(
            'controllerchange',
            () => {
              window.clearTimeout(timeout);
              resolve();
            },
            { once: true }
          );
        });
      }
      return registration;
    } catch (err) {
      if (attempt === attempts) {
        console.warn('[tileCache] Service Worker registration failed:', err);
        return null;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pre-warm
// ---------------------------------------------------------------------------
function prewarmIsStillValid(): boolean {
  try {
    const raw = localStorage.getItem(PREWARM_STAMP_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < PREWARM_TTL_MS;
  } catch {
    return false;
  }
}

function markPrewarmed(): void {
  try {
    localStorage.setItem(PREWARM_STAMP_KEY, String(Date.now()));
  } catch {
    /* private mode - warm-up simply repeats next launch */
  }
}

function serviceWorkerIsControlling(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.serviceWorker &&
    !!navigator.serviceWorker.controller
  );
}

/**
 * How many tiles the Service Worker actually holds.
 *
 * The timestamp alone is not trustworthy: a run where the Service Worker was
 * not yet controlling the page still fetched every tile (populating only the
 * HTTP cache) and would otherwise stamp itself as "warmed", permanently
 * suppressing the real warm-up on every later launch. When a worker is
 * present, the cache itself is the source of truth.
 */
async function countCachedTiles(): Promise<number> {
  try {
    if (typeof caches === 'undefined') return 0;
    const hasCache = await caches.has(TILE_CACHE_NAME);
    if (!hasCache) return 0;
    const cache = await caches.open(TILE_CACHE_NAME);
    const keys = await cache.keys();
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * Downloads the Southern Thailand tile pyramid into the Service Worker cache.
 * Runs at low priority and never rejects: a failed warm-up just means the map
 * fills in on demand, exactly as before.
 */
export async function prefetchSouthernThailandTiles(
  options: {
    includeBoundaries?: boolean;
    minZoom?: number;
    maxZoom?: number;
    force?: boolean;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {}
): Promise<PrewarmResult> {
  const {
    includeBoundaries = false,
    minZoom = PREWARM_MIN_ZOOM,
    maxZoom = PREWARM_MAX_ZOOM,
    force = false,
    signal,
    onProgress,
  } = options;

  const started = Date.now();

  // Two passes, coarse first: the wide surround fills the far field near the
  // horizon, then Southern Thailand gets its detailed pyramid. Ordering matters
  // on a cold start - the surround is what stops the edges looking empty.
  const tiles = [
    ...enumerateRegionTiles(SURROUND_PREWARM_BOUNDS, SURROUND_MIN_ZOOM, SURROUND_MAX_ZOOM),
    ...enumerateRegionTiles(SOUTH_TH_PREWARM_BOUNDS, minZoom, maxZoom),
  ];

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const t of tiles) {
    const imagery = fillTemplate(ESRI_IMAGERY_TILE_URL, t.z, t.x, t.y);
    if (!seen.has(imagery)) {
      seen.add(imagery);
      urls.push(imagery);
    }
    if (includeBoundaries) {
      const boundary = fillTemplate(ESRI_BOUNDARIES_TILE_URL, t.z, t.x, t.y);
      if (!seen.has(boundary)) {
        seen.add(boundary);
        urls.push(boundary);
      }
    }
  }

  const swActive = serviceWorkerIsControlling();

  if (!force) {
    if (swActive) {
      // Trust the cache, not the clock.
      const cached = await countCachedTiles();
      if (cached >= Math.floor(urls.length * 0.8)) {
        console.info(`[tileCache] ${cached} tiles already cached - skipping warm-up.`);
        return { requested: 0, ok: 0, failed: 0, skipped: true, elapsedMs: 0 };
      }
    } else if (prewarmIsStillValid()) {
      // No worker: the fetches can only reach the HTTP cache, so fall back to
      // the timestamp heuristic to avoid re-downloading on every reload.
      return { requested: 0, ok: 0, failed: 0, skipped: true, elapsedMs: 0 };
    }
  }

  let ok = 0;
  let failed = 0;
  let done = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < urls.length) {
      if (signal?.aborted) return;
      const url = urls[cursor++];
      try {
        const res = await fetch(url, { signal, credentials: 'omit' });
        if (res.ok) ok++;
        else failed++;
      } catch {
        failed++;
      }
      done++;
      if (onProgress && done % 10 === 0) onProgress(done, urls.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PREWARM_CONCURRENCY, urls.length) }, () => worker())
  );

  if (!signal?.aborted && failed < urls.length / 2) markPrewarmed();

  const result: PrewarmResult = {
    requested: urls.length,
    ok,
    failed,
    skipped: false,
    elapsedMs: Date.now() - started,
  };

  const stored = swActive ? await countCachedTiles() : 0;

  console.info(
    '[tileCache] Southern Thailand pre-warm: ' +
      ok +
      '/' +
      urls.length +
      ' tiles fetched in ' +
      Math.round(result.elapsedMs / 1000) +
      's' +
      (swActive
        ? ` — ${stored} now held in the Service Worker cache.`
        : ' — no Service Worker; HTTP cache only.')
  );
  return result;
}

// ---------------------------------------------------------------------------
// Diagnostics - handy on the day of the event
// ---------------------------------------------------------------------------
function messageWorker<T>(payload: Record<string, unknown>, timeoutMs = 3000): Promise<T | null> {
  return new Promise((resolve) => {
    const controller =
      typeof navigator !== 'undefined' && navigator.serviceWorker
        ? navigator.serviceWorker.controller
        : null;
    if (!controller) return resolve(null);

    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      resolve(event.data as T);
    };
    controller.postMessage(payload, [channel.port2]);
  });
}

export function getTileCacheStats(): Promise<{ count: number; cacheName: string } | null> {
  return messageWorker({ type: 'TILE_CACHE_STATS' });
}

export async function clearTileCache(): Promise<void> {
  await messageWorker({ type: 'TILE_CACHE_CLEAR' });
  try {
    localStorage.removeItem(PREWARM_STAMP_KEY);
  } catch {
    /* ignore */
  }
}
