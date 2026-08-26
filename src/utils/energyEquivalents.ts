/**
 * energyEquivalents.ts
 * Single home for the environmental conversion factors.
 *
 * These numbers appear on the regional totals panel, on the site sub-page and
 * in the aggregated overview. Keeping one copy is deliberate: duplicated
 * derived values are exactly how the month / year / CO2 tiles ended up silently
 * showing stale figures.
 */

/** Grid emission factor used throughout the dashboard: kg CO2 avoided per kWh. */
export const CO2_KG_PER_KWH = 0.56;

/** Tree-planting equivalent: trees per kWh generated. */
export const TREES_PER_KWH = 0.08;

/** kWh -> tonnes of CO2 avoided ("ton Carbon eq"). */
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
