/**
 * energyEquivalents.ts
 * Single home for the environmental conversion factors.
 *
 * These numbers appear on the regional totals panel, on the site sub-page and
 * in the aggregated overview. Keeping one copy is deliberate: duplicated
 * derived values are exactly how the month / year / CO2 tiles ended up silently
 * showing stale figures.
 */

/**
 * Grid emission factor for LOCALLY derived CO2: kg avoided per kWh.
 *
 * A fallback only. SolarEdge reports CO2 itself, and measurement across all
 * four sites shows it uses exactly 0.3920 kg/kWh - identical from a 513 MWh
 * site down to a 1.5 MWh one. This 0.56 therefore reads about 43% high
 * against the portal, so it is used only when the environmental-benefits
 * endpoint yields nothing at all.
 */
export const CO2_KG_PER_KWH = 0.56;

/**
 * SolarEdge's own grid emission factor: kg CO2 avoided per kWh.
 *
 * Measured, not assumed. /environmental-benefits divided by lifetime energy
 * gives exactly 0.3920 on all four sites, from a 513 MWh plant down to a
 * 1.5 MWh one. Use this for anything that has to agree with the portal but
 * cannot read the endpoint directly — a per-DAY figure, for instance, which
 * SolarEdge only reports cumulatively.
 */
export const CO2_KG_PER_KWH_SE = 0.392;

/** Tree-planting equivalent: trees per kWh generated. */
export const TREES_PER_KWH = 0.08;

/**
 * Kilograms of CO2 that SolarEdge counts as one planted tree.
 *
 * Reverse-engineered from the portal so the dashboard prints the same tree
 * count the operators see there: site 4956359 showed 601.653 kg CO2 next to
 * 17 trees, i.e. 35.4 kg each (601.653 / 35.4 = 17.0). Confirmed live: the
 * same site read 605.88 kg minutes later and still derives 17.
 * This replaces TREES_PER_KWH for anything driven by a real CO2 reading.
 * That factor (0.08 trees/kWh) disagreed with the portal by roughly 7.3x: it
 * would have shown 120 trees where SolarEdge shows 17 for the same site.
 *
 * Validated on ONE site. If a second site disagrees, this constant is the
 * only thing that needs retuning.
 */
export const CO2_KG_PER_TREE = 35.4;

/** Real CO2 in kg -> the tree count SolarEdge would show for it. */
export function treesFromCo2Kg(co2Kg: number): number {
  return Math.round(co2Kg / CO2_KG_PER_TREE);
}

/** kg -> tonnes, for the panels that headline CO2 in tonnes. */
export function co2TonsFromKg(co2Kg: number): number {
  return co2Kg / 1000;
}

/** kWh -> tonnes of CO2 avoided ("tonCO₂e"). */
export function co2TonsFromKwh(kwh: number): number {
  return (kwh * CO2_KG_PER_KWH) / 1000;
}

/** kWh -> equivalent number of trees planted. */
export function treesFromKwh(kwh: number): number {
  return Math.round(kwh * TREES_PER_KWH);
}

/** Total installed capacity in MWp from a list of sites. */
export function totalCapacityMwp(sites: Array<{ capacityKwp: number }>): number {
  return sites.reduce((sum, s) => sum + (s.capacityKwp || 0), 0) / 1000;
}

/** Fixed-decimal thousands formatting, stable enough to read at a distance. */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
