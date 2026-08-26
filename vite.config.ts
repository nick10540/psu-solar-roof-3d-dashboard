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
        '/api/solaredge': {
          target: 'https://monitoringapi.solaredge.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/solaredge/, ''),
        },
      },
    },
  };
});
