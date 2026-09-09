/**
 * siteMultiplier.ts
 * Per-site display multiplier, applied to every measured figure a site shows.
 *
 * WHY THIS EXISTS
 * ---------------
 * A pin sometimes reads from fewer meters than the campus actually has - one
 * registration is readable, the rest of the array is not - so the API's honest
 * reading understates the site by a fixed, known ratio. This is the one knob
 * that corrects for it.
 *
 * Deliberately a config file rather than a control in the settings modal: it
 * changes what the board CLAIMS a site produced, so it should be a reviewed
 * edit in source, not something adjustable mid-ceremony by whoever has the
 * remote.
 *
 * SCOPE
 * -----
 * Every MEASURED figure: current power, today's energy, lifetime energy, and
 * CO2 (an energy figure in different units, so it has to scale with the energy
 * it is derived from or the two stop agreeing).
 *
 * Installed capacity is NOT scaled. It is a nameplate specification with its
 * own source of truth in siteCapacity.ts; multiplying it here would leave one
 * number with two places to keep straight. Correct a capacity by editing the
 * kWp itself.
 *
 * Keyed by `code` rather than `id`, for the same reason as siteCapacity and
 * siteMedia: ids get reassigned when a pin is deleted and re-added, the code
 * stays with the site.
 */

/** The neutral multiplier: show exactly what was measured. */
export const DEFAULT_SITE_MULTIPLIER = 1;

/**
 * Site `code` -> multiplier applied to its measured figures.
 *
 * Every site starts at 1, i.e. this file changes nothing until someone
 * deliberately tunes a row. Listing all five explicitly (rather than leaving
 * the record empty) is the point: the table is where an operator looks to see
 * whether a campus is being scaled, and an absent row reads as "not checked"
 * where an explicit 1 reads as "checked, no correction needed".
 */
const SITE_MULTIPLIER: Record<string, number> = {
  'MEA-SRT-01': 1, // วิทยาเขตสุราษฎร์ธานี
  'MEA-PKT-02': 0.304, // วิทยาเขตภูเก็ต  (อัตราส่วน ภูเก็ต/ปัตตานี = 0.304)
  'MEA-TRG-03': 1, // วิทยาเขตตรัง 
  'MEA-HDY-04': 1, // วิทยาเขตหาดใหญ่
  'MEA-PTN-05': 1, // วิทยาเขตปัตตานี
};

/**
 * The multiplier for a site, or 1 when none is recorded.
 *
 * 1 rather than `null` for the unknown case, unlike capacityKwpFor: a site
 * nobody has tuned must show its reading untouched, and a missing entry is
 * exactly that. Non-finite and non-positive values fall back too - a stray 0
 * here would blank a whole campus to "0.0 kW", which on a big screen reads as
 * a real measurement of nothing rather than as a config mistake.
 */
export function siteMultiplierFor(code: string): number {
  const value = SITE_MULTIPLIER[code];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SITE_MULTIPLIER;
}

/**
 * Scale a metric, preserving "no data".
 *
 * `null` in, `null` out: a site that is not reporting stays not reporting and
 * must never become `0 x multiplier = 0`. Zero is a legitimate reading at
 * night and has to stay distinguishable from "not connected" - the same rule
 * the whole of siteMetricsService is built on.
 */
export function applySiteMultiplier(
  value: number | null,
  multiplier: number
): number | null {
  return value === null ? null : value * multiplier;
}
