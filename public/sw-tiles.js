/**
 * sw-tiles.js — Persistent map tile cache (Service Worker)
 *
 * Why: MapLibre's own tile cache lives in memory and dies with the page.
 * On a TV that runs all day this Service Worker gives the map a durable,
 * cache-first tile store so that after the first warm-up the dashboard makes
 * essentially ZERO network requests for the basemap.
 *
 * Strategy: CACHE-FIRST, NO REVALIDATION.
 *   A cached tile is served straight from disk and is never re-fetched until
 *   it is older than TILE_MAX_AGE_MS. Satellite imagery does not change during
 *   a ceremony, so revalidation is pure waste — and it was the source of the
 *   "hundreds of requests while idle" behaviour.
 */

const CACHE_NAME = 'mea-map-tiles-v2';

/** Tiles older than this are re-fetched once, then cached again. */
const TILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Hard ceiling on stored tiles (~40 KB each => roughly 200 MB worst case). */
const MAX_ENTRIES = 5000;

/** How many stores between LRU trims. */
const TRIM_EVERY = 200;

/** Header we stamp on stored responses so we can age them out. */
const STAMP_HEADER = 'x-mea-cached-at';

const TILE_HOSTS = new Set([
  'server.arcgisonline.com',
  'services.arcgisonline.com',
  'a.basemaps.cartocdn.com',
  'b.basemaps.cartocdn.com',
  'c.basemaps.cartocdn.com',
]);

let storesSinceTrim = 0;

self.addEventListener('install', (event) => {
  // Activate immediately so the very first page load is already covered.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('mea-map-tiles-') && n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/** Allow the page to query / clear the cache. */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = (payload) => {
    if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
  };

  if (data.type === 'TILE_CACHE_STATS') {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        reply({ type: 'TILE_CACHE_STATS', count: keys.length, cacheName: CACHE_NAME });
      })()
    );
  }

  if (data.type === 'TILE_CACHE_CLEAR') {
    event.waitUntil(
      (async () => {
        await caches.delete(CACHE_NAME);
        reply({ type: 'TILE_CACHE_CLEARED' });
      })()
    );
  }
});

function isTileRequest(request) {
  if (request.method !== 'GET') return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  return TILE_HOSTS.has(url.hostname);
}

function isFresh(response) {
  const stamp = response.headers.get(STAMP_HEADER);
  if (!stamp) return true; // stored before stamping existed — treat as fresh
  const age = Date.now() - Number(stamp);
  return Number.isFinite(age) && age < TILE_MAX_AGE_MS;
}

/**
 * Re-wrap a response with our timestamp header so it can be aged out later.
 * Opaque responses (cross-origin without CORS) cannot be read, so they are
 * stored as-is and simply never expire.
 */
async function stamp(response) {
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return response;
  const body = await response.clone().blob();
  const headers = new Headers(response.headers);
  headers.set(STAMP_HEADER, String(Date.now()));
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Cache API keys() returns insertion order, so dropping from the front is a decent LRU-by-age. */
async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isTileRequest(request)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(request, { ignoreVary: true });

      // --- CACHE HIT: serve and stop. No background revalidation. ---
      if (hit && isFresh(hit)) return hit;

      // --- MISS (or stale): go to network. ---
      try {
        const network = await fetch(request);

        // Only store real successes; an opaque response has status 0 but is still usable.
        const storable = network.ok || network.type === 'opaque';
        if (storable) {
          const toStore = await stamp(network.clone());
          await cache.put(request, toStore);

          if (++storesSinceTrim >= TRIM_EVERY) {
            storesSinceTrim = 0;
            // Do not block the response on trimming.
            event.waitUntil(trim(cache));
          }
        }
        return network;
      } catch (err) {
        // Network is down (venue Wi-Fi hiccup). A stale tile beats a grey square.
        if (hit) return hit;
        throw err;
      }
    })()
  );
});
