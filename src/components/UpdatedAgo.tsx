/**
 * UpdatedAgo.tsx
 * The quiet line under a card's figures saying how old they are.
 *
 * Deliberately understated — slate-500, 10px, no icon, no colour change when
 * the data goes stale. It is provenance, not a metric: on a 72" ceremony panel
 * it should be findable by anyone who goes looking for it and invisible to
 * everyone else. The figures above it are what the room is meant to read.
 *
 * The age has to advance on its own — a card whose numbers have not moved for
 * ten minutes still has to count those ten minutes — so this subscribes to a
 * single page-wide ticker rather than each instance owning a timer. Twenty
 * cards on screen is one interval, not twenty, and the ticker stops entirely
 * once the last one unmounts.
 */

import React, { useSyncExternalStore } from 'react';
import { formatAgeThai, formatClockThai } from '../utils/relativeTime';

/**
 * How often the labels re-read the clock.
 *
 * Half a minute: the labels are minute-resolution, so this is the coarsest
 * tick that can never leave one a full minute behind what it should say.
 */
const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let snapshot = Date.now();

/**
 * Subscribe to the shared clock. Returns the unsubscribe.
 *
 * Exported for the map markers, which are plain DOM built once with innerHTML
 * and so cannot use the hook below. They have to share THIS ticker rather than
 * run one of their own: two 30-second intervals started at different moments
 * sit in different phases, and a marker card reading "8 นาทีที่แล้ว" beside a
 * React panel reading "7" — both correct, both stale by a different fraction of
 * a tick — is exactly the sort of thing a 72" display makes obvious.
 */
export function subscribeToClock(onChange: () => void): () => void {
  return subscribe(onChange);
}

/**
 * The shared "now" every age line on the page is measured against.
 *
 * Falls back to a live read while the ticker is stopped. With no subscribers
 * `snapshot` is frozen at whenever the last age line unmounted, and the map
 * paints its first marker before its own subscription lands — ageing that paint
 * against a dead clock. There is nothing on screen to disagree with at that
 * point, so a fresh read is strictly the better answer.
 */
export function getClockNow(): number {
  return timer ? snapshot : Date.now();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  if (!timer) {
    // Re-read on the way in as well: with no subscribers the timer is stopped,
    // so `snapshot` is frozen at whenever the last card unmounted. Mounting a
    // card would otherwise age it against a clock that had stopped.
    snapshot = Date.now();
    timer = setInterval(() => {
      snapshot = Date.now();
      listeners.forEach((fn) => fn());
    }, TICK_MS);
  }

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = (): number => snapshot;

/** "Now", to a 30-second resolution, shared by every card on the page. */
export function useClockTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

interface UpdatedAgoProps {
  /** Epoch ms of the reading itself, from `parseReadingTimestamp`. */
  at: number | null;
  /** Extra classes for placement — spacing and alignment, not colour or size. */
  className?: string;
}

/**
 * Renders nothing when there is no stamp.
 *
 * A card with no data has nothing to be the age OF, and "อัปเดตเมื่อสักครู่"
 * under an em-dash would read as a fresh confirmation that there is nothing —
 * which is the opposite of what an unbound pin means.
 */
export const UpdatedAgo: React.FC<UpdatedAgoProps> = ({ at, className }) => {
  const now = useClockTick();
  const label = formatAgeThai(at, now);
  if (!label) return null;

  return (
    <div
      className={`text-[10px] leading-none text-slate-500 font-normal truncate ${className ?? ''}`}
      title={formatClockThai(at) ?? undefined}
    >
      {label}
    </div>
  );
};
