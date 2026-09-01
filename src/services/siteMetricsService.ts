/**
 * siteMetricsService.ts
 * The single place that decides what number a site is allowed to show.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every display surface used to reach for its own fallback:
 *
 *     const power = overview ? overview.currentPowerKw : site.currentPowerKw;
 *
 * which meant that in Live API mode, a site with no API connection quietly
 * rendered its seeded demo figure. On a ceremony screen an invented number is
 * far worse than a blank one - nobody can tell it is not real.
 *
 * The rule now, in one place:
 *
 *   mock mode  -> simulated figures are expected and fine.
 *   live mode  -> ONLY a genuine SolarEdge reading for a site that has been
 *                 explicitly mapped to this pin. Everything else is `null`,
 *                 and `null` renders as "no data" everywhere.
 *
 * `null` is deliberate rather than 0: zero is a legitimate reading at night.
 */

import {
  BuildingInfo,
  BuildingSiteBinding,
  SolarEdgeTransformedOverview,
  bindingSiteIds,
} from '../types';

import { capacityKwpFor } from '../config/siteCapacity';

import { CO2_KG_PER_KWH } from '../utils/energyEquivalents';

export type DataSourceMode = 'mock' | 'live';

/** A number, or `null` meaning "no data". Never 0-as-unknown. */
export type MetricValue = number | null;

/** Where a site's displayed figures came from. */
export type MetricSource = 'mock' | 'live' | 'none';

export interface ResolvedSiteMetrics {
  buildingId: number;
  /** SolarEdge site id this pin is mapped to, if any. */
  siteId: number | null;
  /** Every SolarEdge site ID feeding this pin. Figures are their sum. */
  siteIds: number[];
  isBound: boolean;
  /** True only when real, displayable figures are available. */
  hasData: boolean;
  source: MetricSource;
  currentPowerKw: MetricValue;
  todayEnergyKwh: MetricValue;
  lifetimeEnergyKwh: MetricValue;
  capacityKwp: MetricValue;
  /**
   * Cumulative CO2 avoided, in KILOGRAMS.
   *
   * In live mode this is SolarEdge's own figure, passed through untouched.
   * In mock mode it is derived from the simulated lifetime energy, like
   * every other mock number here.
   */
  co2Kg: MetricValue;
  lastUpdateTime: string | null;
}

export interface RegionalTotals {
  siteCount: number;
  /** How many pins are actually reporting. Lets the UI be honest about partial coverage. */
  sitesWithData: number;
  hasData: boolean;
  mode: DataSourceMode;
  totalCapacityKwp: MetricValue;
  currentPowerKw: MetricValue;
  todayEnergyKwh: MetricValue;
  lifetimeEnergyKwh: MetricValue;
  /** Sum of the reporting sites' CO2, in kg. */
  co2Kg: MetricValue;
}

export function dataSourceModeFromConfig(useMock: boolean): DataSourceMode {
  return useMock ? 'mock' : 'live';
}

/**
 * A pin with nothing behind it. Exported because every display surface needs
 * the same shape for "no data" - the map, the site sub-page, and anything added
 * later - and a second hand-written copy is how the fallbacks crept back in.
 */
export function emptySiteMetrics(
  buildingId: number,
  siteId: number | null = null,
  isBound = false,
  siteIds: number[] = [],
  capacityKwp: MetricValue = null
): ResolvedSiteMetrics {
  return {
    buildingId,
    siteId,
    siteIds,
    isBound,
    hasData: false,
    source: 'none',
    currentPowerKw: null,
    todayEnergyKwh: null,
    lifetimeEnergyKwh: null,
    // Capacity survives "no data": it is a nameplate spec, not a reading.
    capacityKwp,
    co2Kg: null,
    lastUpdateTime: null,
  };
}

/**
 * Decide what a single pin may display.
 *
 * A pin may be bound to up to MAX_SITE_IDS_PER_BUILDING SolarEdge sites, for a
 * campus whose array is split across several registrations. Every measured
 * figure here is the SUM across the bound IDs; the map card is handed one total
 * and is unaware that more than one site fed it.
 *
 * In live mode an overview carrying `isMockData` is rejected outright - that
 * flag is the service's own marker for a simulated payload, and it must never
 * reach the screen while the dashboard claims to be showing live data.
 */
export function resolveSiteMetrics(
  building: BuildingInfo,
  binding: BuildingSiteBinding | undefined,
  overviews: Record<number, SolarEdgeTransformedOverview>,
  mode: DataSourceMode
): ResolvedSiteMetrics {
  const siteIds = bindingSiteIds(binding);
  const isBound = siteIds.length > 0;
  const primaryId = siteIds[0] ?? null;

  /**
   * Installed capacity, fixed per site rather than read from the API.
   *
   * Independent of binding and of mode, so an unbound pin still states what is
   * on its roof while its production cells read "no data".
   */
  const capacityKwp: MetricValue = capacityKwpFor(building.code) ?? building.capacityKwp ?? null;

  if (mode === 'live') {
    const live = siteIds
      .map((id) => overviews[id])
      .filter((ov): ov is SolarEdgeTransformedOverview => Boolean(ov) && !ov.isMockData);

    // No mapping, no readings, or only simulated payloads -> nothing measured.
    // One dead ID among three does NOT blank the pin: the sites that did report
    // are still real, and their sum is still the best available total.
    if (live.length === 0) {
      return emptySiteMetrics(building.id, primaryId, isBound, siteIds, capacityKwp);
    }

    const sum = (pick: (ov: SolarEdgeTransformedOverview) => number): number =>
      live.reduce((acc, ov) => acc + (pick(ov) || 0), 0);

    // CO2 is summed only over the sites that actually reported one. Treating a
    // missing figure as 0 would understate the total without saying so.
    const co2Values = live
      .map((ov) => ov.co2Kg)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    // The freshest stamp across the group: the oldest would make a live pin
    // look stale because one of its sites reports less often.
    const stamps = live.map((ov) => ov.rawTimestamp).filter(Boolean);
    const newest = stamps.length > 0 ? stamps.slice().sort().pop() : null;
    const newestLabel =
      live.find((ov) => ov.rawTimestamp === newest)?.lastUpdateTime ??
      live[0].lastUpdateTime;

    return {
      buildingId: building.id,
      siteId: primaryId,
      siteIds,
      isBound,
      hasData: true,
      source: 'live',
      currentPowerKw: Math.round(sum((ov) => ov.currentPowerKw) * 10) / 10,
      todayEnergyKwh: Math.round(sum((ov) => ov.dailyEnergyKwh) * 10) / 10,
      lifetimeEnergyKwh: sum((ov) => ov.lifetimeEnergyKwh),
      capacityKwp,
      co2Kg: co2Values.length > 0 ? co2Values.reduce((a, b) => a + b, 0) : null,
      lastUpdateTime: newestLabel,
    };
  }

  // --- mock mode ---
  // The building's own figures are used rather than the bound mock overview:
  // they are what the live simulation ticks, so the pins, the regional totals
  // and the simulated clock all move together instead of drifting apart.
  return {
    buildingId: building.id,
    siteId: primaryId,
    siteIds,
    isBound,
    hasData: true,
    source: 'mock',
    currentPowerKw: building.currentPowerKw,
    todayEnergyKwh: building.todayEnergyKwh,
    lifetimeEnergyKwh: building.lifetimeEnergyKwh,
    capacityKwp,
    co2Kg: building.lifetimeEnergyKwh * CO2_KG_PER_KWH,
    lastUpdateTime: null,
  };
}

/** Resolve every pin in one pass. */
export function resolveAllSiteMetrics(
  buildings: BuildingInfo[],
  bindings: Record<number, BuildingSiteBinding>,
  overviews: Record<number, SolarEdgeTransformedOverview>,
  mode: DataSourceMode
): ResolvedSiteMetrics[] {
  return buildings.map((b) => resolveSiteMetrics(b, bindings[b.id], overviews, mode));
}

/**
 * Roll the pins up into the regional totals.
 *
 * Only reporting sites contribute to the MEASURED figures. If none report,
 * those totals are `null` rather than 0 - a dashboard reading "0.0 kWh" looks
 * like a real measurement of nothing, which is exactly the wrong impression.
 *
 * Installed capacity is the exception, and deliberately so: it is a fixed
 * nameplate figure, so it sums across EVERY pin whether or not that pin is
 * reporting. The headline therefore states the whole fleet's capacity rather
 * than only the part that happens to be online.
 */
export function aggregateSiteMetrics(
  metrics: ResolvedSiteMetrics[],
  mode: DataSourceMode
): RegionalTotals {
  const reporting = metrics.filter((m) => m.hasData);

  const capacityValues = metrics
    .map((m) => m.capacityKwp)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const totalCapacityKwp: MetricValue =
    capacityValues.length > 0 ? capacityValues.reduce((a, b) => a + b, 0) : null;

  if (reporting.length === 0) {
    return {
      siteCount: metrics.length,
      sitesWithData: 0,
      hasData: false,
      mode,
      totalCapacityKwp,
      currentPowerKw: null,
      todayEnergyKwh: null,
      lifetimeEnergyKwh: null,
      co2Kg: null,
    };
  }

  const sum = (pick: (m: ResolvedSiteMetrics) => MetricValue): number =>
    reporting.reduce((acc, m) => acc + (pick(m) ?? 0), 0);

  return {
    siteCount: metrics.length,
    sitesWithData: reporting.length,
    hasData: true,
    mode,
    totalCapacityKwp,
    currentPowerKw: Math.round(sum((m) => m.currentPowerKw) * 10) / 10,
    todayEnergyKwh: Math.round(sum((m) => m.todayEnergyKwh) * 10) / 10,
    lifetimeEnergyKwh: sum((m) => m.lifetimeEnergyKwh),
    co2Kg: sum((m) => m.co2Kg),
  };
}
