/**
 * markerTypography.ts
 * Single source of truth for the size of everything inside the map marker HUD
 * cards (Solar3DViewer's `createMarkerElement`).
 *
 * The marker is built once per site as a raw HTML string (see the stability
 * contract at the top of Solar3DViewer.tsx), so its text sizes can't come
 * from Tailwind's `text-[Npx]` classes with a value computed at runtime -
 * Tailwind only generates CSS for arbitrary-value classes that appear as a
 * literal string in source. These are applied as inline `font-size` styles
 * instead, sourced from here, so every card on the map can be resized
 * dashboard-wide by editing one number in this file.
 *
 * Units: px.
 */
export const MARKER_FONT_SIZES = {
  /** Site name in the card header, e.g. "วิทยาเขตตรัง". */
  title: 15,
  /** Site code badge, e.g. "MEA-TRG-03" (hidden by default - see `code` span). */
  code: 10,
  /** Metric label under each grid cell, e.g. "กำลังผลิต", "พลังงานรวม". */
  metricLabel: 12,
  /**
   * The metric's numeric value, e.g. "156.8".
   *
   * SIGNED OFF ON THE 72" PANEL - do not change. Everything else in this file
   * is sized in relation to it, so retune the surrounding text instead.
   */
  metricValue: 20,
  /** Unit suffix next to a metric value, e.g. "kW", "kWh", "kWp". */
  metricUnit: 11,
  /** Row holding the status line and the "view site" link. */
  statusRow: 11,
  /** "SolarEdge Live" / "Mock Simulator" source line. */
  statusText: 11,
  /** "ดูหน้าย่อยไซต์ ➔" link to the site sub-page. */
  actionLink: 12,
  /** Site number inside the blue pin circle beneath the card. */
  pinNumber: 14,
} as const;

/**
 * Card geometry, in px.
 *
 * Width is an inline style on the marker root (a runtime value again, so not a
 * Tailwind class). It has to clear the widest metric cell: a value at
 * `metricValue` plus its unit at `metricUnit` on one nowrap line, three across.
 * Undersizing it clips the numbers rather than wrapping them.
 */
export const MARKER_CARD = {
  /** Outer marker box. The card centres inside it and self-sizes to its metrics. */
  widthPx: 320,
  /**
   * Height of the photo / video banner at the top of the card.
   *
   * Trades presence against pile-up: the five pins sit close together at the
   * default zoom and each card grows upward from its pin, so every px here is
   * a px of overlap with the site to the north. 120 keeps the clip clearly
   * readable without burying the neighbouring card's numbers.
   */
  mediaHeightPx: 120,
} as const;
