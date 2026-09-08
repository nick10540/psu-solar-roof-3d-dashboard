/**
 * hudScale.ts
 * One number that shrinks everything floating over the map when the board is
 * not filling a display.
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
 * viewport (and in fullscreen, whatever the display) it is exactly 1 and
 * nothing changes; in a smaller window every card is drawn proportionally
 * smaller, and past a point the camera zooms out with them - see
 * `hudZoomOffset`, which is what keeps the outermost pins inside a narrow
 * frame rather than leaving their cards half over the edge.
 *
 * WHY FULLSCREEN IS PINNED TO 1
 * -----------------------------
 * Fullscreen is the ceremony. The card sizes, the per-site nudges in
 * markerTypography and the totals-panel placement were all tuned against that
 * view and accepted as they are, overlaps included - so the presentation path
 * deliberately gets no scaling at all rather than a factor that happens to
 * land near 1. Everything below is about the windowed case.
 *
 * WHAT IT IS APPLIED TO
 * ---------------------
 * As a CSS `transform: scale()` on whole HUD elements, never by multiplying
 * the font sizes alone. The cards carry Tailwind padding, radii, gaps and a
 * pin drawn from utility classes; scaling only the type would shrink the
 * numbers inside a box that stayed put. One transform takes the lot, and it
 * costs nothing on the compositor.
 */

/**
 * The viewport every HUD size was measured against: a maximized window on the
 * 1920x1080 panel. Width matches the "1904px viewport" the marker offsets in
 * markerTypography.ts were measured at; the height is that display less the
 * browser's own chrome.
 */
export const HUD_REFERENCE_VIEWPORT = { width: 1904, height: 1040 } as const;

/**
 * Floor on the scale.
 *
 * At 0.6 the metric values land at 12px and the standard card at 192px wide,
 * which is still legible at a desk. Below that the cards stop being readable
 * before they stop colliding, so a very small window gets clipped cards
 * instead of unreadable ones - the map is not the thing a 900px window is for.
 */
export const MIN_HUD_SCALE = 0.6;

/**
 * Slack when comparing the viewport to the display it sits on.
 *
 * Fractional display scaling (125% here) means these two rarely divide to
 * whole numbers, and a fullscreen window can measure a pixel or two short of
 * the screen it covers.
 */
const FULLSCREEN_TOLERANCE_PX = 4;

/**
 * Is this the presentation view - i.e. must the HUD stay at its signed-off
 * size?
 *
 * `fullscreenElement` alone is not enough: it is set by the header bar's
 * fullscreen button, but F11 and Chrome's `--kiosk` never touch the Fullscreen
 * API, and the kiosk at the venue is started one of those two ways. So the
 * fallback is measured rather than asked for - a window that covers its whole
 * display is the ceremony case regardless of what put it there.
 */
export function isPresentationViewport(): boolean {
  if (typeof window === 'undefined') return true;
  if (document.fullscreenElement) return true;

  const { width, height } = window.screen;
  return (
    window.innerWidth >= width - FULLSCREEN_TOLERANCE_PX &&
    window.innerHeight >= height - FULLSCREEN_TOLERANCE_PX
  );
}

/**
 * The HUD scale for the viewport as it is right now.
 *
 * `min` of the two axes rather than width alone: at pitch 60 the framing is far
 * more sensitive to height than to width - lose 90px of height and the
 * perspective throws the outer pins clean off the left and right edges - so
 * height is usually the axis that decides this.
 *
 * Rounded to two decimals so a drag-resize settles on a handful of distinct
 * values instead of a new font size every pixel.
 */
export function computeHudScale(): number {
  if (typeof window === 'undefined') return 1;
  if (isPresentationViewport()) return 1;

  const raw = Math.min(
    window.innerWidth / HUD_REFERENCE_VIEWPORT.width,
    window.innerHeight / HUD_REFERENCE_VIEWPORT.height
  );

  const clamped = Math.min(1, Math.max(MIN_HUD_SCALE, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * The largest a card may be drawn relative to the scene under it before the
 * five cards start colliding.
 *
 * Measured, not chosen. Every card grows upward from its own pin, so whether
 * two of them collide is decided by the ratio between card size and the pixel
 * distance between their pins - not by either on its own. At the reference
 * framing the tightest pair is สุราษฎร์ธานี over ตรัง: their pins sit 262px
 * apart vertically and the standard card is 325px tall, so the upper card's
 * bottom edge clears the lower card's top edge as soon as the cards are drawn
 * at 262/325 = 0.806 of the scene's scale. Every other pair clears earlier
 * (ภูเก็ต at 0.84, ตรัง x หาดใหญ่ at 0.97 horizontally).
 *
 * 0.8 is that threshold with a little margin. At the reference itself the
 * ratio is 1, which is exactly why that view has the overlaps documented in
 * markerTypography.ts and accepted there.
 */
const HUD_CARD_TO_SCENE_RATIO = 0.8;

/**
 * How much of the scene's scale the camera has to give up so the cards have
 * room, expressed as the zoom levels to add to a stored camera.
 *
 * Shrinking the cards buys room on its own: at 0.8 of full size they need a
 * fifth less space between pins, so down to a HUD scale of 0.8 the camera is
 * left alone entirely and the pins stay where the operators framed them. Below
 * that the cards can no longer make up the difference by themselves and the
 * scene has to come with them, which is also what pulls the outermost pins -
 * ภูเก็ต and ปัตตานี - back inside a narrow frame instead of leaving their
 * cards hanging over the edge.
 *
 * `log2` because a zoom level is a factor of two in ground pixels. The result
 * is 0 at any HUD scale of 0.8 or above, so the presentation camera - and any
 * window roughly four fifths of the panel - is untouched.
 */
export function hudZoomOffset(hudScale: number): number {
  return Math.log2(Math.min(1, hudScale / HUD_CARD_TO_SCENE_RATIO));
}
