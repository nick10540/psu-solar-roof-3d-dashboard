import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

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
        const file = MAPLIBRE_WORKER_FILES.find((f) => req.url?.split('?')[0] === routeFor(f));
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
    plugins: [react(), tailwindcss(), maplibreWorkerAssets()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
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
