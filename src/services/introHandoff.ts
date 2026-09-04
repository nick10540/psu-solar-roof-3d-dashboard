/**
 * introHandoff.ts
 * One-shot signal: the intro has handed the screen over to the dashboard.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A PROP
 *
 * IntroVideoOverlay and App are siblings under the root (see main.tsx) - the
 * overlay deliberately covers the dashboard rather than gating it. Turning
 * this into a prop would mean hoisting state into a new root component and
 * then threading a boolean through App, which does not care about it, purely
 * to reach one effect inside Solar3DViewer.
 *
 * So: a single module-scoped latch, with the two properties that matter for a
 * signal that fires exactly once per page load -
 *
 *  - it cannot fire twice (StrictMode remounts the overlay in dev, and every
 *    exit path in the overlay funnels through the same dismiss), and
 *  - a subscriber that arrives after the fact is told immediately, so nothing
 *    depends on the mount order of two separate trees.
 * ---------------------------------------------------------------------------
 */

type Listener = () => void;

let handedOver = false;
const listeners = new Set<Listener>();

/** True once the intro has started its fade, or if there was never one. */
export function hasIntroFinished(): boolean {
  return handedOver;
}

/**
 * Called by the intro overlay as the fade to the dashboard begins - not when
 * the overlay is finally removed. The dashboard is already visible through the
 * fade, so anything waiting on this should be moving by then.
 */
export function notifyIntroFinished(): void {
  if (handedOver) return;
  handedOver = true;

  listeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      // One bad subscriber must not stop the others being told.
      console.warn('[introHandoff] A listener threw:', err);
    }
  });
  listeners.clear();
}

/**
 * Subscribe to the handover. Returns an unsubscribe.
 *
 * If it has already happened the listener is invoked at once and there is
 * nothing to unsubscribe from.
 */
export function subscribeIntroFinished(listener: Listener): () => void {
  if (handedOver) {
    listener();
    return () => {};
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
