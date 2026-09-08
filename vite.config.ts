import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * HTTP Basic auth for the dev and preview servers.
 *
 * Production is gated by nginx instead - docker/nginx.conf includes an
 * .htpasswd built at container start, which covers the SPA and the
 * /api/solaredge proxy in one place and is where the dashboard is actually
 * exposed. This plugin exists because `npm run dev` binds 0.0.0.0 (see the
 * `dev` script), so a dev server running at the venue is reachable by anyone
 * on that network. It reads the same BASIC_AUTH_USER / BASIC_AUTH_PASSWORD
 * names as docker-compose.yml, so there is one set of credentials to know.
 *
 * Opt-in here, unlike the container, which refuses to start without
 * credentials: leaving the variables unset keeps localhost development exactly
 * as it was. Set both to switch it on.
 *
 * Not equivalent to the nginx gate, and not meant to be: Vite's HMR WebSocket
 * is upgraded before any connect middleware runs, so it stays open. This
 * closes the HTTP surface - it is hardening for a dev server on a hostile
 * network, not a way to serve the dashboard from one.
 */
function basicAuth(): Plugin {
  const user = process.env.BASIC_AUTH_USER || '';
  const password = process.env.BASIC_AUTH_PASSWORD || '';
  const realm = process.env.BASIC_AUTH_REALM || 'PSU Solar Roof Dashboard';

  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

  /**
   * Compare in constant time.
   *
   * Digested first because timingSafeEqual throws outright on a length
   * mismatch - which both leaks the credential's length and turns a wrong
   * password into a 500. Two SHA-256 digests are always 32 bytes.
   */
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const matches = (header: string) => timingSafeEqual(digest(header), digest(expected));

  const guard = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const header = req.headers.authorization;
    if (typeof header === 'string' && matches(header)) return next();

    res.statusCode = 401;
    // charset="UTF-8" so a non-ASCII password is submitted as UTF-8 rather
    // than the browser's guess at a legacy encoding.
    res.setHeader('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
    res.end('401 Unauthorized\n');
  };

  return {
    name: 'mea-basic-auth',

    configureServer(server) {
      if (!user || !password) return;
      // Registered from configureServer without the returned-thunk form, so it
      // lands BEFORE Vite's own middlewares and nothing - not the transformed
      // modules, not the /api/solaredge proxy - answers unauthenticated. This
      // plugin is first in the plugins array for the same reason.
      server.middlewares.use(guard);
    },

    configurePreviewServer(server) {
      if (!user || !password) return;
      server.middlewares.use(guard);
    },
  };
}

/**
 * MapLibre's worker.
 *
 * MapLibre 6 locates its worker by resolving `maplibre-gl-worker.mjs` against
 * its own `import.meta.url`. Neither place Vite serves the library from has
 * that file beside it: in dev the library is prebundled into
 * `node_modules/.vite/deps/`, and in a build it is folded into
 * `assets/index-*.js`. So the worker URL 404s, the worker never starts, and
 * every request the map makes of it waits for a reply that never comes.
 *
 * That failure is silent, and it was invisible here for a long time: raster
 * tiles do not go through the worker, and this dashboard's style is
 * raster-only, so the map looked perfectly healthy. Anything worker-backed
 * does not - a GeoJSON source simply stays `isSourceLoaded() === false` for
 * ever, drawing nothing and raising no error. The site link line
 * (siteLinkService) was the first thing here to need it.
 *
 * So the worker, and the chunk it imports from, are served from one stable
 * path in both dev and build, read straight out of the installed package so
 * they cannot drift from the version in node_modules. `setWorkerUrl` in
 * main.tsx points MapLibre at it.
 */
const MAPLIBRE_WORKER_ROUTE = 'maplibre';

/** Order matters only for readability; the first imports the second. */
const MAPLIBRE_WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'] as const;

function maplibreWorkerAssets(): Plugin {
  const distDir = path.resolve(__dirname, 'node_modules/maplibre-gl/dist');
  const routeFor = (file: string) => `/${MAPLIBRE_WORKER_ROUTE}/${file}`;

  return {
    name: 'mea-maplibre-worker-assets',

    // Dev: hand the two files straight off disk.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Matched on the tail rather than the whole path, so a configured
        // `base` (which main.tsx prefixes onto the worker URL) still lands
        // here instead of falling through to the SPA fallback.
        const reqPath = req.url?.split('?')[0] ?? '';
        const file = MAPLIBRE_WORKER_FILES.find((f) => reqPath.endsWith(routeFor(f)));
        if (!file) return next();

        // A module worker: the browser refuses it under any other MIME type,
        // and the refusal looks exactly like the 404 this exists to fix.
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(path.join(distDir, file)));
      });
    },

    // Build: emit them un-hashed, so the path stays the one main.tsx names.
    generateBundle() {
      for (const file of MAPLIBRE_WORKER_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `${MAPLIBRE_WORKER_ROUTE}/${file}`,
          source: readFileSync(path.join(distDir, file)),
        });
      }
    },
  };
}

export default defineConfig(() => {
  return {
    // basicAuth() first: plugin order is middleware order, and the gate has to
    // sit in front of maplibreWorkerAssets(), which also serves files.
    plugins: [basicAuth(), react(), tailwindcss(), maplibreWorkerAssets()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      /**
       * 3000 by default, or whatever `PORT` says.
       *
       * The port used to be a `--port=3000` flag on the `dev` script, which
       * made it impossible for a tool that assigns its own port to start this
       * server at all - it would always try to claim 3000 and collide with a
       * copy already running. Reading the env var here keeps `npm run dev` on
       * 3000 exactly as before while letting anything that needs a different
       * port ask for one.
       */
      port: Number(process.env.PORT) || 3000,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        // Points at the local SolarEdge backend (worker/), NOT at SolarEdge.
        // The OAuth client id / secret live in that process, so the browser
        // only ever talks to this origin and no credential reaches the bundle.
        // Start it with `npm run worker` (or `npm run dev:all`).
        '/api/solaredge': {
          target: process.env.SOLAREDGE_BACKEND_URL || 'http://localhost:8787',
          changeOrigin: false,
          secure: false,
        },
      },
    },
  };
});
