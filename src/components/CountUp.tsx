/**
 * CountUp.tsx
 * Animated number that eases from its previous value to a new one.
 *
 * Used for every figure on the dashboard that changes on a poll — power,
 * energy, CO2, trees, capacity, revenue — but deliberately NOT for the clock:
 * a running clock is already a continuous readout, and easing it would make it
 * briefly show times that were never true.
 *
 * The behaviour (ease direction, first-paint snap, reduced motion, default
 * precision) lives in utils/animateNumber so the map's marker cards — plain
 * DOM that React never renders — animate identically. Edit it there.
 *
 * Two things worth knowing before editing:
 *
 *  1. It animates FROM THE LAST DISPLAYED VALUE, not from zero, and it runs
 *     downwards just as happily as up. The dashboard refreshes every five
 *     minutes, and replaying 0 → 611,317 on each tick would read as the plant
 *     restarting rather than as a small update.
 *
 *  2. `requestAnimationFrame`, not `setInterval`. The frame callback is tied to
 *     the display refresh, so the animation stays smooth, and the browser stops
 *     calling it entirely while the tab is hidden — which matters on a kiosk
 *     that is left running for weeks.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  easeOutCubic,
  formatNumber,
  fractionDigitsOf,
  prefersReducedMotion,
} from '../utils/animateNumber';

interface CountUpProps {
  /** The value to land on. `null` renders the placeholder. */
  target: number | null;
  /** How long the run takes, in milliseconds. */
  duration?: number;
  /**
   * Decimal places to show. Omitted, it follows the target's own precision, so
   * 3,213.5 keeps its tenth and 8,612 does not grow a ".0".
   *
   * Needed as well as thousands separators: this dashboard prints 0.61 tonCO₂
   * next to 611,317 kWh, so a single fixed format cannot serve both.
   */
  decimals?: number;
  /** Rendered when `target` is not a usable number, e.g. an unbound site. */
  placeholder?: string;
  className?: string;
}

export const CountUp: React.FC<CountUpProps> = ({
  target,
  duration = 900,
  decimals,
  placeholder = '—',
  className,
}) => {
  const isValid = typeof target === 'number' && Number.isFinite(target);
  const safeTarget = isValid ? (target as number) : 0;
  const places = decimals ?? fractionDigitsOf(safeTarget);

  const [displayed, setDisplayed] = useState<number>(safeTarget);

  /** What is on screen right now — the start point for the next run. */
  const displayedRef = useRef<number>(safeTarget);
  /**
   * Skips the animation on the first real value. Also re-armed whenever the
   * figure goes to no-data, so a site coming back online snaps to its reading
   * instead of gliding up from a value it no longer had.
   */
  const hasValueRef = useRef<boolean>(false);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isValid) {
      hasValueRef.current = false;
      return;
    }

    if (!hasValueRef.current) {
      hasValueRef.current = true;
      displayedRef.current = safeTarget;
      setDisplayed(safeTarget);
      return;
    }

    const from = displayedRef.current;
    if (from === safeTarget) return;

    if (prefersReducedMotion() || duration <= 0) {
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

  return <span className={className}>{formatNumber(displayed, places)}</span>;
};
