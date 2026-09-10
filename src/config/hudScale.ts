/**
 * hudScale.ts
 * One number that shrinks (or grows) everything floating over the map to
 * match the CSS viewport it is actually being drawn into.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every size in markerTypography.ts, and the totals panel that borrows from
 * it, is an absolute px value measured on the ceremony panel - see the
 * reference framing notes there. Absolute px do not care how large the window
 * is, so the same 320px card that reads correctly across a hall covers a third
 * of a 1500px browser window: the cards pile onto each other and the ones on
 * the edges of the frame get cut off by it.
 *
 * This is the responsive factor those sizes were missing. At the reference
 * viewport it is exactly 1 and nothing changes; on any other viewport every
 * card is drawn proportionally smaller or larger, and the camera zooms with
 * it by exactly the same factor - see `hudZoomOffset` - so the board is always
 * a uniform scale of the reference framing, never a crop of it.
 *
 * WHY FULLSCREEN IS *NOT* PINNED TO 1 ANYMORE
 * ---------------------------------------------
 * An earlier version of this file short-circuited to scale 1 whenever the
 * window was fullscreen (or covered its whole display), on the theory that
 * fullscreen IS the ceremony. That was wrong: `window.screen.width/height`
 * report CSS pixels, so browser page zoom and OS display scaling shrink the
 * window's CSS viewport and the "whole display" test together - a venue panel
 * running at 150% Windows scaling, or a browser at 125% page zoom, measures as
 * fullscreen while its actual CSS viewport is far smaller than
 * HUD_REFERENCE_VIEWPORT. The short-circuit then drew reference-size cards on
 * that smaller canvas without zooming the camera out to match, which is
 * exactly the "cards overlap and the outer two are clipped by the bezel"
 * failure this file exists to prevent. The fix is to always measure the real
 * CSS viewport, fullscreen or not - see `computeHudScale`.
 *
 * WHAT IT IS APPLIED TO
 * ---------------------
 * As a CSS `transform: scale()` on whole HUD elements, never by multiplying
 * the font sizes alone. The cards carry Tailwind padding, radii, gaps and a
 * pin drawn from utility classes; scaling only the type would shrink the
 * numbers inside a box that stayed put. One transform takes the lot, and it
 * costs nothing on the compositor. See HudFrame.tsx for the React overlays
 * (masthead, clock, totals band) and Solar3DViewer's `applyHudScale` for the
 * map markers, which are plain DOM and scale individually.
 *
 * THE OPERATOR TRIM
 * ------------------
 * `computeHudScale()` alone answers "what does the viewport need"; it is
 * deliberately never allowed to draw the board LARGER than the signed-off
 * reference size on its own (see its own `Math.min(1, ...)`;. A human may
 * still choose to, though - `useHudScaleTrim` (src/hooks/useHudScaleTrim.ts)
 * is a small operator-facing multiplier on top, adjustable from the map's
 * control drawer, for the venue case no formula can see coming (a projector
 * that needs the board a size up, or a touch panel where the automatic fit is
 * a few percent tighter than the operator wants). `computeEffectiveHudScale`
 * is where the two combine into the one number everything else consumes.
 */

/**
 * The viewport every HUD size was measured against: a maximized window on the
 * 1920x1080 panel. Width matches the "1904px viewport" the marker offsets in
 * markerTypography.ts were measured at; the height is that display less the
 * browser's own chrome.
 */
export const HUD_REFERENCE_VIEWPORT = { width: 1904, height: 1040 } as const;

/**
 * Floor on the automatic scale, and on the composite (automatic x trim).
 *
 * At 0.6 the metric values land at 12px and the standard card at 192px wide,
 * which is still legible at a desk. Below that the cards stop being readable
 * before they stop colliding, so a very small window gets clipped cards
 * instead of unreadable ones - the map is not the thing a 900px window is for.
 *
 * It is also the arithmetic floor for `hudZoomOffset`: with DEFAULT_ZOOM 7.47
 * and MIN_ZOOM 6.5 (mapConfig.ts), there are only 0.97 zoom levels of room to
 * zoom the camera out, i.e. a hard composite floor of 2^-0.97 = 0.511 before
 * MapLibre clamps the zoom and the uniform-scale guarantee breaks (cards keep
 * shrinking while the ground span stops growing to match). 0.6 gives 0.233
 * levels of margin below that wall.
 */
export const MIN_HUD_SCALE = 0.6;

/**
 * Ceiling on the composite (automatic x trim) scale.
 *
 * The automatic factor alone never exceeds 1 (see `computeHudScale`), so this
 * only bites once a manual trim is in play - matching `HUD_MANUAL_SCALE_MAX`,
 * since 1 x 1.3 = 1.3. Past ~1.3 the three reference-framing overlaps
 * documented and accepted in markerTypography.ts (MARKER_CARD_OFFSETS) start
 * to outgrow the one nudge that manages them.
 *
 * WHERE TRIM > 1 ACTUALLY HAS ROOM, AND WHERE IT DOESN'T
 * ---------------------------------------------------------
 * `computeHudScale()`'s own viewport ratio IS the largest scale that draws
 * HUD_REFERENCE_VIEWPORT without any part of it running past the canvas - that
 * is what a `min()` of the two axis ratios means. So a trim above 1 only has
 * genuine headroom on a viewport that measures LARGER than the reference on
 * both axes - the automatic factor is clamped to 1 there even though it has
 * room to grow (see `computeHudScale`), and the trim is exactly how an
 * operator claims that headroom back. On any OTHER viewport - which is every
 * viewport this whole file exists for, venue panel included - the automatic
 * scale has already used up the fit with zero to spare on its binding axis,
 * so pushing the trim past 1 there necessarily draws HudFrame's 1904x1040 box
 * larger than the canvas and something near its edge runs past the bezel.
 * The masthead is the first casualty (see HudFrame.tsx and CeremonyHero.tsx -
 * it sits with almost no margin above its own top edge), well before the pin
 * cards, which were laid out with real clearance from the frame's edges.
 *
 * This is not clamped away, on purpose: it is the same trade-off any "zoom
 * past 100%" control makes, it is immediately visible to whoever is holding
 * +, and it is always reversible in one tap - the percent chip that resets it
 * lives outside every hudScale-transformed subtree (HudScaleControl.tsx), so
 * it is never itself a casualty of the thing it undoes.
 */
export const MAX_HUD_SCALE = 1.3;

/**
 * The operator trim, applied as a multiplier on top of the automatic scale -
 * see useHudScaleTrim.ts for the live control this backs.
 *
 * Narrower than screen brightness's 0.6-1.6 (useScreenBrightness.ts) on
 * purpose: brightness is a perceptual filter with no geometric consequence,
 * while this number drives both card px and a camera zoom offset, and both
 * ends hit a hard wall (MIN_HUD_SCALE / MAX_HUD_SCALE above). Step 0.05 rather
 * than brightness's 0.1: one step is log2(1.05) = 0.07 zoom levels - a nudge,
 * not a lurch - and moves the outermost card's edge by ~40px at the reference
 * framing, close enough to "just clear of the bezel" that an operator will not
 * routinely overshoot it.
 */
export const HUD_MANUAL_SCALE_MIN = 0.7;
export const HUD_MANUAL_SCALE_MAX = 1.3;
export const HUD_MANUAL_SCALE_STEP = 0.05;
export const HUD_MANUAL_SCALE_DEFAULT = 1;

/**
 * The automatic HUD scale for the viewport as it is right now.
 *
 * Always measures the real CSS viewport - see the file header for why this no
 * longer short-circuits to 1 in fullscreen.
 *
 * `min` of the two axes rather than width alone: at pitch 60 the framing is far
 * more sensitive to height than to width - lose 90px of height and the
 * perspective throws the outer pins clean off the left and right edges - so
 * height is usually the axis that decides this.
 *
 * Capped at 1: this factor alone must never draw the board LARGER than the
 * signed-off reference size - a bigger-than-reference viewport (a real 4K
 * panel at 100% scaling, say) leaves the board at its reference size, smaller
 * than the frame, rather than blown up past what was signed off. Only the
 * operator's trim (see HUD_MANUAL_SCALE_MAX) may push it past 1, deliberately.
 *
 * Rounded to two decimals so a drag-resize settles on a handful of distinct
 * values instead of a new font size every pixel.
 */
export function computeHudScale(): number {
  if (typeof window === 'undefined') return 1;

  const raw = Math.min(
    window.innerWidth / HUD_REFERENCE_VIEWPORT.width,
    window.innerHeight / HUD_REFERENCE_VIEWPORT.height
  );

  const clamped = Math.min(1, Math.max(MIN_HUD_SCALE, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * Rounds to the same precision as `computeHudScale`, so a composite value that
 * passes through here churns the marker/totals-band transform strings on the
 * same handful of distinct steps rather than on every drag-resize pixel.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The one number every HUD consumer actually applies: the automatic viewport
 * scale, multiplied by the operator's manual trim, clamped to the board's hard
 * geometric limits.
 *
 * A ratio, not an offset added to the automatic value - the same choice
 * siteMultiplier.ts makes for the same class of correction, and for the same
 * reason: an additive nudge would mean the same tap does a different thing on
 * a different panel (a different automatic scale), which is not a setting an
 * operator can reason about across venues.
 */
export function computeEffectiveHudScale(trim: number): number {
  return round2(Math.min(MAX_HUD_SCALE, Math.max(MIN_HUD_SCALE, computeHudScale() * trim)));
}

/**
 * How much of the scene's scale the camera should give up (or gain), expressed
 * as the zoom levels to add to a stored/default camera.
 *
 * A pure `log2` of the HUD scale - `log2` because a zoom level is a factor of
 * two in ground pixels, so this is exactly the offset that keeps every pin's
 * separation, and therefore every card, scaled by the SAME factor as the HUD
 * scale itself. That is what makes the board a uniform scale of the reference
 * framing at any viewport: cards shrink/grow by `hudScale`, the ground span
 * shown shrinks/grows by the same factor in the other direction, and the two
 * exactly cancel in the ratio that decides whether cards collide.
 *
 * An earlier version capped this at a card-to-scene ratio of 0.8, deliberately
 * cropping up to 20% of the region so the cards had room without colliding on
 * their own. That crop is what made "the board looks like a scaled screenshot
 * 2" false below scale 0.8: the camera and the cards were shrinking at
 * different rates. The operator's manual trim (useHudScaleTrim.ts) is the
 * replacement for that headroom - a human can still choose to shrink the
 * cards a step further than the automatic scale would, but the camera always
 * matches them, so the framing is never silently cropped.
 */
export function hudZoomOffset(hudScale: number): number {
  return Math.log2(hudScale);
}
