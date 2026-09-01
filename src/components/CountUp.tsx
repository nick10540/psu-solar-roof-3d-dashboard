/**
 * CountUp.tsx
 * Animated number that eases from its previous value to a new one.
 *
 * Used for every figure on the dashboard that changes on a poll — power,
 * energy, CO2, trees, capacity — but deliberately NOT for the clock: a running
 * clock is already a continuous readout, and easing it would make it briefly
 * show times that were never true.
 *
 * Two things worth knowing before editing:
 *
 *  1. It animates FROM THE LAST DISPLAYED VALUE, not from zero. The dashboard
 *     refreshes every five minutes, and replaying 0 → 611,317 on each tick
 *     would read as the plant restarting rather than as a small update. On the
 *     very first render it snaps straight to the target for the same reason.
 *
 *  2. `requestAnimationFrame`, not `setInterval`. The frame callback is tied to
 *     the display refresh, so the animation stays smooth, and the browser stops
 *     calling it entirely while the tab is hidden — which matters on a kiosk
 *     that is left running for weeks.
 */

import React, { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  /** The value to land on. */
  target: number;
  /** How long the run takes, in milliseconds. */
  duration?: number;
  /**
   * Decimal places to show.
   *
   * Needed as well as thousands separators: this dashboard prints 0.61 tonCO₂
   * next to 611,317 kWh, so a single fixed format cannot serve both.
   */
  decimals?: number;
  /** Rendered when `target` is not a usable number, e.g. an unbound site. */
  placeholder?: string;
  className?: string;
}

/**
 * Ease-out cubic: fast off the mark, then settling.
 *
 * Cubic rather than quadratic because the last 10% of the run is where the eye
 * checks the number against what it expects, and the gentler tail reads as
 * "arriving" instead of "stopping".
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function format(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export const CountUp: React.FC<CountUpProps> = ({
  target,
  duration = 900,
  decimals = 0,
  placeholder = '—',
  className,
}) => {
  const isValid = typeof target === 'number' && Number.isFinite(target);
  const safeTarget = isValid ? target : 0;

  const [displayed, setDisplayed] = useState<number>(safeTarget);

  /** What is on screen right now — the start point for the next run. */
  const displayedRef = useRef<number>(safeTarget);
  /** Skips the animation on mount so the first paint is the real figure. */
  const mountedRef = useRef<boolean>(false);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isValid) return;

    if (!mountedRef.current) {
      mountedRef.current = true;
      displayedRef.current = safeTarget;
      setDisplayed(safeTarget);
      return;
    }

    const from = displayedRef.current;
    if (from === safeTarget) return;

    // Someone who has asked their OS to reduce motion gets the number, not the
    // journey. Checked here rather than at module scope so the setting can be
    // changed without a reload.
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || duration <= 0) {
      displayedRef.current = safeTarget;
      setDisplayed(safeTarget);
      return;
    }

    const delta = safeTarget - from;
    let startedAt: number | null = null;

    const step = (now: number) => {
      if (startedAt === null) startedAt = now;
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / duration);
      const value = from + delta * easeOutCubic(t);

      displayedRef.current = value;
      setDisplayed(value);

      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        // Land exactly on the target: easing leaves a sub-pixel remainder that
        // would otherwise print as 611,316.9998.
        displayedRef.current = safeTarget;
        setDisplayed(safeTarget);
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [safeTarget, duration, isValid]);

  if (!isValid) {
    return <span className={className}>{placeholder}</span>;
  }

  return (
    <span className={className}>{format(displayed, decimals)}</span>
  );
};
