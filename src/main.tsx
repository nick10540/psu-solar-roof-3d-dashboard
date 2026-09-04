import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setWorkerUrl } from 'maplibre-gl';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { IntroVideoOverlay } from './components/IntroVideoOverlay.tsx';
import {
  registerTileCacheWorker,
  prefetchSouthernThailandTiles,
} from './services/tileCacheService';
import './index.css';

/**
 * Point MapLibre at its worker.
 *
 * Must happen before any Map is constructed, which is why it sits here rather
 * than in Solar3DViewer: the worker pool is created with the first map and
 * reads this once.
 *
 * MapLibre's own guess at the URL cannot work under Vite - the file is not
 * beside the library in either the dev dep cache or a build - so the worker
 * never starts and every worker-backed source hangs unloaded without raising
 * anything. `maplibreWorkerAssets` in vite.config.ts serves this path in both
 * dev and build; the full story is in the comment there.
 */
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

// Safely suppress harmless third-party browser extension errors (e.g., MetaMask, crypto wallet injects)
if (typeof window !== 'undefined') {
  const originalOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    const strMsg = String(message || '');
    if (
      strMsg.includes('MetaMask') ||
      strMsg.includes('ethereum') ||
      strMsg.includes('wallet') ||
      strMsg.includes('Failed to connect to MetaMask')
    ) {
      console.warn('Suppressed third-party extension error:', strMsg);
      return true; // prevent error bubbling
    }
    if (originalOnError) {
      return originalOnError(message, source, lineno, colno, error);
    }
    return false;
  };

  window.addEventListener('unhandledrejection', (event) => {
    const reasonStr = String(event.reason?.message || event.reason || '');
    if (
      reasonStr.includes('MetaMask') ||
      reasonStr.includes('ethereum') ||
      reasonStr.includes('wallet') ||
      reasonStr.includes('Failed to connect to MetaMask')
    ) {
      console.warn('Suppressed third-party extension unhandled rejection:', reasonStr);
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      {/*
        Intro clip, last so it paints over the dashboard (see
        IntroVideoOverlay.tsx). App mounts underneath it and warms up during
        the clip, so this is a cover, not a gate - and it removes itself on
        the first of: clip ended, operator skipped, file failed.

        Inside the same boundary as App on purpose: an intro that could throw
        its own error card into the page alongside a running dashboard would
        be worse than the crash it was reporting. The component keeps its own
        risky calls (play, sessionStorage) wrapped.
      */}
      <IntroVideoOverlay />
    </ErrorBoundary>
  </StrictMode>,
);

/**
 * Map tile cache bootstrap.
 *
 * Registers the Service Worker that serves basemap tiles cache-first, then
 * pre-warms the Southern Thailand pyramid (z6-z9, roughly 180 tiles / ~6 MB).
 * After the first successful warm-up the regional view is fully local, so the
 * dashboard can sit on screen all day without touching the tile servers again.
 *
 * Deliberately kicked off AFTER render and inside an idle callback: warming the
 * cache must never delay first paint or compete with the visible map.
 */
function bootstrapTileCache(): void {
  const start = () => {
    registerTileCacheWorker()
      .then(() => prefetchSouthernThailandTiles({ includeBoundaries: false }))
      .catch((err) => {
        // Warm-up is an optimisation, never a requirement.
        console.warn('[tileCache] Warm-up skipped:', err);
      });
  };

  type IdleWindow = Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  const w = window as IdleWindow;

  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(start, { timeout: 4000 });
  } else {
    window.setTimeout(start, 2000);
  }
}

if (typeof window !== 'undefined') {
  bootstrapTileCache();
}
