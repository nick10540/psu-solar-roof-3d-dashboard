/**
 * animateNumber.ts
 * The shared vocabulary for "a figure changed, so let the eye follow it".
 *
 * Two consumers, one behaviour:
 *
 *  - `CountUp` (React) for anything rendered by a component.
 *  - `animateNumberText` for the map's marker cards, which are built with
 *    innerHTML and patched through `textContent` — React never sees them, so
 *    they need the same easing driven imperatively.
 *
 * Rules that hold for both, because a dashboard where half the numbers glide
 * and half of them jump reads as broken:
 *
 *  1. Animate FROM THE LAST DISPLAYED VALUE, in either direction. Power falls
 *     as often as it rises; a counter that only counts up is a counter that
 *     lies on the way down.
 *  2. The first value a node ever shows is not animated. On a five-minute
 *     poll, replaying 0 → 611,317 on arrival reads as the plant restarting.
 *  3. Coming back from "no data" also snaps: there is no honest number to
 *     travel from.
 *  4. `prefers-reduced-motion` gets the number, not the journey. Read per call
 *     so the OS setting can change without a reload.
 */

/** Ease-out cubic: fast off the mark, gentle where the eye checks the value. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Fraction digits to animate a figure at, when the caller has not said.
 *
 * Taken from the target itself so the tween lands on exactly the text the
 * static formatter would have printed: 3,213.5 keeps its tenth, 8,612 does not
 * grow a ".0", and a float artefact like 1014.0999999 is capped rather than
 * spraying digits across the card.
 */
export function fractionDigitsOf(value: number, max = 2): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = Math.abs(value).toFixed(max);
  const trimmed = text.replace(/0+$/, '');
  const dot = trimmed.indexOf('.');
  return dot === -1 ? 0 : trimmed.length - dot - 1;
}

/** Thousands separators, fixed precision. The dashboard prints en-US digits. */
export function formatNumber(value: number, decimals: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface TweenState {
  frame: number | null;
  /** What this node currently shows, as a number. NaN while it shows no-data. */
  value: number;
}

/** Per-node tween state. Weak so a removed marker takes its entry with it. */
const tweens = new WeakMap<HTMLElement, TweenState>();

export interface AnimateNumberTextOptions {
  /** Defaults to the target's own precision — see `fractionDigitsOf`. */
  decimals?: number;
  duration?: number;
  /** Printed when there is no number to show. */
  placeholder?: string;
  /** Overrides the default thousands-separated formatting. */
  format?: (value: number) => string;
}

/**
 * Ease `el`'s text from whatever it last showed to `target`.
 *
 * Pass `null` for "no data": the node snaps to the placeholder and forgets its
 * value, so the next real reading arrives without a tween from a stale figure.
 */
export function animateNumberText(
  el: HTMLElement,
  target: number | null,
  options: AnimateNumberTextOptions = {}
): void {
  const { duration = 900, placeholder = '—' } = options;

  const previous = tweens.get(el);
  if (previous?.frame != null) {
    cancelAnimationFrame(previous.frame);
    previous.frame = null;
  }

  if (target === null || !Number.isFinite(target)) {
    tweens.set(el, { frame: null, value: NaN });
    if (el.textContent !== placeholder) el.textContent = placeholder;
    return;
  }

  const decimals = options.decimals ?? fractionDigitsOf(target);
  const print = options.format ?? ((v: number) => formatNumber(v, decimals));

  const from = previous && Number.isFinite(previous.value) ? previous.value : null;
  const settle = () => {
    tweens.set(el, { frame: null, value: target });
    const text = print(target);
    if (el.textContent !== text) el.textContent = text;
  };

  if (from === null || from === target || duration <= 0 || prefersReducedMotion()) {
    settle();
    return;
  }

  const delta = target - from;
  const state: TweenState = { frame: null, value: from };
  tweens.set(el, state);

  let startedAt: number | null = null;
  const step = (now: number) => {
    // A marker can be torn off the map mid-run; stop rather than tick against
    // a detached node for the rest of the session.
    if (!el.isConnected) {
      state.frame = null;
      state.value = target;
      return;
    }

    if (startedAt === null) startedAt = now;
    const t = Math.min(1, (now - startedAt) / duration);
    const value = from + delta * easeOutCubic(t);

    state.value = value;
    el.textContent = print(value);

    if (t < 1) {
      state.frame = requestAnimationFrame(step);
    } else {
      // Land exactly on the target: the easing tail leaves a remainder that
      // would otherwise print as 611,316.9998.
      state.frame = null;
      state.value = target;
      el.textContent = print(target);
    }
  };

  state.frame = requestAnimationFrame(step);
}
