/**
 * useLongRunGuard.ts
 * Safety net for unattended kiosk operation (72" TV, opening ceremony).
 *
 * Even a leak-free app accumulates fragmentation over 10+ hours in a browser.
 * This hook watches uptime and (on Chromium) JS heap growth, and performs a
 * full page reload ONLY when the screen has been idle for a while - so it can
 * never interrupt someone driving the dashboard in front of an audience.
 */

import { useEffect, useRef } from 'react';

export interface LongRunGuardOptions {
  /** Master switch. */
  enabled?: boolean;
  /**
   * Scheduled reload after this much uptime. OFF by default.
   *
   * A purely time-based reload is a liability during a ceremony: switch the
   * screen on at 07:00 with an 8-hour timer and it can fire at 15:00, in the
   * middle of the event, during any quiet 10-minute stretch. Enable this only
   * for a screen that runs unattended for days.
   */
  reloadOnUptime?: boolean;
  /** Uptime threshold when `reloadOnUptime` is enabled. Default 12 hours. */
  maxUptimeMs?: number;
  /** Only reload after this much continuous user inactivity. Default 10 minutes. */
  requiredIdleMs?: number;
  /**
   * Reload if the JS heap exceeds this share of the limit (Chromium only).
   * This is the trigger worth keeping on: it fires only when something has
   * genuinely gone wrong, not merely because time has passed.
   * Default 0.85.
   */
  heapPressureRatio?: number;
  /** How often to evaluate. Default 60 s. */
  checkIntervalMs?: number;
  /** Called just before reloading. */
  onBeforeReload?: (reason: 'uptime' | 'heap') => void;
}

interface ChromeMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
];

export function useLongRunGuard(options: LongRunGuardOptions = {}): void {
  const {
    enabled = true,
    reloadOnUptime = false,
    maxUptimeMs = 12 * 60 * 60 * 1000,
    requiredIdleMs = 10 * 60 * 1000,
    heapPressureRatio = 0.85,
    checkIntervalMs = 60 * 1000,
    onBeforeReload,
  } = options;

  const startedAtRef = useRef<number>(Date.now());
  const lastActivityRef = useRef<number>(Date.now());
  const onBeforeReloadRef = useRef(onBeforeReload);

  useEffect(() => {
    onBeforeReloadRef.current = onBeforeReload;
  }, [onBeforeReload]);

  useEffect(() => {
    if (!enabled) return;

    const markActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // `passive` keeps pointermove/wheel off the scrolling critical path.
    ACTIVITY_EVENTS.forEach((evt) => {
      window.addEventListener(evt, markActivity, { passive: true });
    });

    const reload = (reason: 'uptime' | 'heap') => {
      console.warn('[longRunGuard] Reloading dashboard. Reason: ' + reason);
      try {
        onBeforeReloadRef.current?.(reason);
      } catch {
        /* never block the reload */
      }
      window.location.reload();
    };

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const idleFor = now - lastActivityRef.current;

      // Never reload while someone is interacting with the dashboard.
      if (idleFor < requiredIdleMs) return;

      if (reloadOnUptime && now - startedAtRef.current >= maxUptimeMs) {
        reload('uptime');
        return;
      }

      const memory = (performance as Performance & { memory?: ChromeMemory }).memory;
      if (memory && memory.jsHeapSizeLimit > 0) {
        const ratio = memory.usedJSHeapSize / memory.jsHeapSizeLimit;
        if (ratio >= heapPressureRatio) {
          reload('heap');
        }
      }
    }, checkIntervalMs);

    return () => {
      window.clearInterval(intervalId);
      ACTIVITY_EVENTS.forEach((evt) => {
        window.removeEventListener(evt, markActivity);
      });
    };
  }, [enabled, reloadOnUptime, maxUptimeMs, requiredIdleMs, heapPressureRatio, checkIntervalMs]);
}
