/**
 * HudFrame.tsx
 * A box the exact size of HUD_REFERENCE_VIEWPORT (1904x1040), centred on the
 * browser viewport and scaled by `hudScale` - see config/hudScale.ts for why
 * that number exists and what it composes.
 *
 * WHY A FIXED-SIZE FRAME RATHER THAN SCALING EACH OVERLAY WHERE IT STANDS
 * -------------------------------------------------------------------------
 * CeremonyHero, CeremonyClock and RegionalTotalsPanel were all laid out and
 * measured directly against the 1904x1040 reference viewport: a masthead
 * inset in px, a clock gutter computed from `100vw`, a totals band positioned
 * by a measured px offset from the masthead and the outermost card. None of
 * that math means anything once it runs against a DIFFERENT real viewport -
 * `100vw` on a 1280px window is not the 1904px the clock's gutter was tuned
 * against. Putting every such overlay inside a box that is ALWAYS 1904x1040,
 * and letting ONE transform resize that whole box to fit the real viewport,
 * means every measurement these components already carry stays correct
 * exactly as written - nothing here re-derives what "middle of the map" or
 * "224px clear of the bezel" means at another size, because as far as the
 * overlays inside the frame are concerned, the viewport never changed.
 *
 * `position: fixed`, DELIBERATELY NOT `absolute`
 * -------------------------------------------------
 * `computeHudScale()` (config/hudScale.ts) measures `window.innerWidth /
 * window.innerHeight` - the whole browser viewport - against
 * HUD_REFERENCE_VIEWPORT, because that is what HUD_REFERENCE_VIEWPORT's own
 * comment says it was measured as ("a maximized window ... less the browser's
 * own chrome"). The map canvas this would otherwise be centred inside is
 * SMALLER than that by a constant amount - `<main>`'s own p-2/p-2.5 padding
 * and the canvas div's border - a fixed ~11px per side that does not scale
 * with the window. Centring a 1904x1040 box on the CANVAS with `absolute`
 * therefore overshoots the canvas by exactly that margin on every side, even
 * at hudScale 1 - a small, constant, viewport-size-independent misalignment
 * that isn't the crop-and-clip the reference framing was measured against.
 * `fixed` centres against the viewport directly, matching the exact
 * measurement `computeHudScale()` itself uses, so the two agree by
 * construction rather than by an equal-to-within-11px coincidence.
 *
 * Safe here specifically because nothing between `<html>` and this component
 * sets a `transform`/`filter`/`perspective`/`will-change: transform` that
 * would hijack a `fixed` descendant's containing block - the one filter in
 * this codebase that comes close (screen brightness, useScreenBrightness.ts)
 * is deliberately kept on `<html>` for exactly this reason, and `<html>`'s own
 * box already coincides with the viewport. Z-index still compares normally
 * against everything else on the page - `position: relative` on `<main>`
 * carries no z-index of its own, so it opens no new stacking context to trap
 * this component inside.
 *
 * Every Tailwind class inside a child of this frame that used to key off a
 * REAL viewport breakpoint (`sm:`, `xl:`, `2xl:`, `min-[Npx]:`) has to be
 * frozen to whichever value it resolved to AT 1904px - see the comments in
 * CeremonyHero.tsx and CeremonyClock.tsx. A breakpoint variant means nothing
 * inside a box whose CSS size never changes; only this wrapper's own
 * `transform: scale()` may vary with the real viewport.
 *
 * Two independent instances exist (App.tsx for the masthead + clock,
 * Solar3DViewer.tsx for the totals band) rather than one shared instance,
 * because their contents are owned and rendered by two different components.
 * Both take the SAME `hudScale` number from `useHudScale()` and both centre on
 * the same viewport, so they resolve to the same box.
 *
 * `pointer-events-none` throughout - this sits over a live MapLibre canvas,
 * and every child that needs a tap (the totals band's "ดูหน้าย่อยไซต์" links,
 * were it ever made interactive) has to opt back in with its own
 * `pointer-events-auto`, exactly like the pin cards already do.
 */

import React from 'react';
import { HUD_REFERENCE_VIEWPORT } from '../config/hudScale';

interface HudFrameProps {
  /** The effective scale from useHudScale() - automatic fit x operator trim. */
  hudScale: number;
  /** Stacking context and any extra positioning for this instance. */
  className?: string;
  children: React.ReactNode;
}

export const HudFrame: React.FC<HudFrameProps> = ({ hudScale, className, children }) => (
  <div
    className={`fixed left-1/2 top-1/2 pointer-events-none ${className ?? ''}`}
    style={{
      width: HUD_REFERENCE_VIEWPORT.width,
      height: HUD_REFERENCE_VIEWPORT.height,
      // translate() resolves its percentages against this element's own
      // (pre-transform) box, so it always centres the full 1904x1040 frame
      // regardless of the scale() applied alongside it; scale() then runs
      // around transform-origin, which keeps that already-centred point fixed.
      transform: `translate(-50%, -50%) scale(${hudScale})`,
      transformOrigin: 'center',
    }}
  >
    {children}
  </div>
);
