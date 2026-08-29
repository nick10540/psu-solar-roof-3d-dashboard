import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
