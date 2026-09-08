/**
 * siteCapacity.ts
 * Installed DC capacity (kWp) per site, as a fixed nameplate figure.
 *
 * Deliberately NOT read from SolarEdge. `peakPower` from `/sites/{id}` is an
 * extra dependency on a call whose budget matters, and the number it returns is
 * a registration value that can disagree with what was actually built - หาดใหญ่
 * reports 1500 there against the 5839.65 commissioned on site.
 *
 * Showing this while a pin has no live reading is not the same class of problem
 * as showing invented production. Capacity is a SPECIFICATION: it is true
 * whether or not an inverter is talking to us tonight. Power, energy and CO2
 * stay blank when unbound, because those are measurements.
 *
 * Keyed by `code` rather than `id` for the same reason as siteMedia: ids get
 * reassigned when a pin is deleted and re-added, the code stays with the site.
 */

/**
 * Site `code` -> installed capacity in kWp.
 *
 * Revised to the as-built figures on 2026-09-08. They sum to 11,275.20 kWp,
 * which is the total the board prints — `totalFixedCapacityKwp` adds these up,
 * so the headline follows this table and is not stored anywhere separately.
 */
const SITE_CAPACITY_KWP: Record<string, number> = {
  'MEA-SRT-01': 996.75, // วิทยาเขตสุราษฎร์ธานี
  'MEA-PKT-02': 972, // วิทยาเขตภูเก็ต
  'MEA-TRG-03': 997.2, // วิทยาเขตตรัง
  'MEA-HDY-04': 5839.65, // วิทยาเขตหาดใหญ่
  'MEA-PTN-05': 2469.6, // วิทยาเขตปัตตานี
};

/**
 * The fixed capacity for a site, or `null` when none has been recorded.
 *
 * `null` rather than 0 so a site added later reads as "unknown" instead of as a
 * real measurement of nothing, matching how every other figure behaves.
 */
export function capacityKwpFor(code: string): number | null {
  const value = SITE_CAPACITY_KWP[code];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Sum of the fixed capacities for a set of sites, in kWp. */
export function totalFixedCapacityKwp(codes: string[]): number | null {
  let total = 0;
  let found = false;
  for (const code of codes) {
    const value = capacityKwpFor(code);
    if (value === null) continue;
    total += value;
    found = true;
  }
  return found ? total : null;
}
