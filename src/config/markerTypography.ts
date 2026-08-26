/**
 * markerTypography.ts
 * Single source of truth for font sizes inside the map marker HUD cards
 * (Solar3DViewer's `createMarkerElement`).
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
  /** Site name in the card header, e.g. "ตรัง". */
  title: 12,
  /** Site code badge, e.g. "MEA-TRG-03" (hidden by default - see `code` span). */
  code: 9,
  /** Metric label under each grid cell, e.g. "กำลังผลิต", "พลังงานรวม". */
  metricLabel: 10,
  /** The metric's numeric value, e.g. "156.8". */
  metricValue: 20,
  /** Unit suffix next to a metric value, e.g. "kW", "kWh", "kWp". */
  metricUnit: 8,
  /** Small lightning-bolt glyph before the power value. */
  metricIcon: 9,
  /** Row holding the status line and the "view site" link. */
  statusRow: 9.5,
  /** "SolarEdge Ready" / live-source status line. */
  statusText: 9,
  /** "ดูหน้าย่อยไซต์ ➔" link to the site sub-page. */
  actionLink: 10,
  /** Site number inside the blue pin circle beneath the card. */
  pinNumber: 12,
} as const;
