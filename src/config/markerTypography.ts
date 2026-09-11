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
 * Units: px, at the reference viewport. Every number here - the font sizes,
 * the card geometry and the per-site nudges at the bottom - is what the card
 * measures on the ceremony panel. In a smaller window the whole card is drawn
 * through one transform that shrinks it proportionally, so these stay the
 * sizes to tune and none of them needs a breakpoint of its own. See
 * config/hudScale.ts.
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
  /**
   * "อัปเดต 3 นาทีที่แล้ว" — the age of the reading, under the status line.
   *
   * The smallest type on the card, and deliberately a step below
   * `statusText`: the age is provenance rather than a figure, and it was asked
   * for on the condition that it stay out of the way of the numbers above it.
   */
  updatedAgo: 10,
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
 *
 * 420, not the original 320: with a thousands separator restored on every
 * metric (energy and capacity both print grouped digits - "2,469.60", not
 * "2469.60"), the widest realistic reading in a 1-of-3 cell needs more room
 * than 320 has to give. Measured empirically, not calculated from character
 * counts, because canvas/DOM text-metric estimates disagreed with real layout
 * by 15-20px in this exact file's own testing:
 *   - capacity up to "5,839.65 kWp" (หาดใหญ่, the featured card) needed the
 *     cell 11px wider than 320 gave it, at zero margin.
 *   - lifetime energy is a one-way accumulator that only ever grows; even
 *     today's "435,800 kWh"-scale readings were within a few px of the same
 *     wall, worse on the featured card.
 * 420 clears both with several px of real margin (re-verified the same way,
 * not estimated) rather than reopening this the next time either figure grows
 * a digit.
 */
export const MARKER_CARD = {
  /** Outer marker box. The card centres inside it and self-sizes to its metrics. */
  widthPx: 420,
  /**
   * Height of the photo / video banner at the top of the card.
   *
   * Trades presence against pile-up: the five pins sit close together at the
   * default zoom and each card grows upward from its pin, so every px here is
   * a px of overlap with the site to the north. 120 keeps the clip clearly
   * readable without burying the neighbouring card's numbers.
   */
  mediaHeightPx: 120,
  /**
   * The one campus whose card is drawn larger than the rest.
   *
   * หาดใหญ่ is the main campus, so its pin carries more visual weight than
   * the four regional ones. Everything else is pinned to exactly widthPx so
   * the remaining cards read as one set rather than four slightly
   * different sizes decided by whichever number happened to be longest.
   */
  featuredSiteCode: 'MEA-HDY-04',
  /** Multiplier applied to the featured card's width, banner and text. */
  featuredScale: 1.3,
} as const;

/**
 * Size multiplier for one site's marker.
 *
 * Applied to the card width, the banner height and every font size, so the
 * featured card scales as a whole instead of growing a wider box around
 * unchanged text.
 */
export function markerScaleFor(siteCode: string): number {
  return siteCode === MARKER_CARD.featuredSiteCode ? MARKER_CARD.featuredScale : 1;
}

/**
 * Banner height for one site, overriding MARKER_CARD.mediaHeightPx.
 *
 * The banner is `object-cover`, so a box shaped differently from the footage
 * crops the difference away rather than letterboxing it. At widthPx 320 a
 * 120px banner is 2.67:1 while the clips are 16:9, which was cutting a third
 * off the top and bottom of every frame.
 *
 * 236 is exactly 16:9 of widthPx (420), so หาดใหญ่'s clips fill the banner
 * with nothing trimmed and no bars - recomputed to stay exactly 16:9 when
 * widthPx moved from 320 to 420 (see MARKER_CARD's own comment). It does cost
 * card height, and mediaHeightPx's note applies - those px overlap the site
 * to the north.
 */
const MEDIA_HEIGHT_OVERRIDE_PX: Record<string, number> = {
  'MEA-HDY-04': 236, // 16:9 of widthPx, so the footage is shown whole
};

/**
 * A site's banner height before the featured scale, in px.
 *
 * Goes through here rather than reading mediaHeightPx directly so a site whose
 * footage is shaped differently from the default banner can be given a box
 * that matches it, instead of every site sharing one crop.
 */
export function markerMediaHeightFor(siteCode: string): number {
  return MEDIA_HEIGHT_OVERRIDE_PX[siteCode] ?? MARKER_CARD.mediaHeightPx;
}

/**
 * One of the sizes above at the featured (หาดใหญ่) card's scale, in px.
 *
 * For panels outside the map that are meant to read at the same size as the
 * featured card - RegionalTotalsPanel does. Going through here rather than
 * copying "26" across files means retuning `metricValue` or `featuredScale`
 * moves both, instead of leaving the panel behind at the old size.
 */
export function featuredCardFontSizePx(key: keyof typeof MARKER_FONT_SIZES): number {
  return MARKER_FONT_SIZES[key] * MARKER_CARD.featuredScale;
}

/**
 * Per-site nudges applied to the card, in px.
 *
 * The five pins sit close together at the default camera, and every card grows
 * upward from its own pin, so at 320-416px wide some of them necessarily
 * collide. Measured at the default framing on a 1904px viewport:
 *
 *   หาดใหญ่ × ปัตตานี   85px wide, full height  -> ปัตตานี moves right
 *   สุราษฎร์ × ตรัง      141 x 42px              -> accepted, see below
 *   สุราษฎร์ × ภูเก็ต     44 x 26px               -> accepted, see below
 *
 * หาดใหญ่ is deliberately NOT moved: it is the featured card and sits only 3px
 * clear of ตรัง on its left, so shifting it left would trade one collision for
 * a worse one.
 *
 * สุราษฎร์ is deliberately NOT moved either, and that one is a reversal: it
 * carried dy -52 to clear the two collisions above. The operators asked for its
 * card to sit against its own pin the way every other card does, preferring the
 * overlap to a card floating clear of the pin it labels. Putting the lift back
 * is a one-line change if that call is ever reversed.
 *
 * These are tuned to the DEFAULT camera. Pan or zoom far from it and cards can
 * meet again — the alternative was shrinking the cards until nothing collided,
 * which costs the legibility the 72" panel was sized for.
 *
 * The three collisions above are the FULLSCREEN ones, and they are the reason
 * config/hudScale.ts exists: in a window there is no 72" viewing distance to
 * protect, so the cards are shrunk relative to the scene until exactly these
 * pairs come apart. Nothing here needs to change for that - it is applied on
 * top of these values, not instead of them.
 */
export const MARKER_CARD_OFFSETS: Record<string, { dx: number; dy: number }> = {
  'MEA-PTN-05': { dx: 96, dy: 0 }, // ปัตตานี — step right of หาดใหญ่
};

/** The nudge for one site, or zero when it needs none. */
export function markerCardOffsetFor(siteCode: string): { dx: number; dy: number } {
  return MARKER_CARD_OFFSETS[siteCode] ?? { dx: 0, dy: 0 };
}
