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
} from '../types';

export type DataSourceMode = 'mock' | 'live';

/** A number, or `null` meaning "no data". Never 0-as-unknown. */
export type MetricValue = number | null;

/** Where a site's displayed figures came from. */
export type MetricSource = 'mock' | 'live' | 'none';

export interface ResolvedSiteMetrics {
  buildingId: number;
  /** SolarEdge site id this pin is mapped to, if any. */
  siteId: number | null;
  isBound: boolean;
  /** True only when real, displayable figures are available. */
  hasData: boolean;
  source: MetricSource;
  currentPowerKw: MetricValue;
  todayEnergyKwh: MetricValue;
  lifetimeEnergyKwh: MetricValue;
  capacityKwp: MetricValue;
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
}

export function dataSourceModeFromConfig(useMock: boolean): DataSourceMode {
  return useMock ? 'mock' : 'live';
}

function emptyMetrics(
  buildingId: number,
  siteId: number | null,
  isBound: boolean
): ResolvedSiteMetrics {
  return {
    buildingId,
    siteId,
    isBound,
    hasData: false,
    source: 'none',
    currentPowerKw: null,
    todayEnergyKwh: null,
    lifetimeEnergyKwh: null,
    capacityKwp: null,
    lastUpdateTime: null,
  };
}

/**
 * Decide what a single pin may display.
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
  const siteId = binding?.isBound ? binding.siteId ?? null : null;
  const isBound = siteId !== null;
  const overview = siteId !== null ? overviews[siteId] ?? null : null;

  if (mode === 'live') {
    // No mapping, no reading, or a simulated payload -> nothing to show.
    if (!overview || overview.isMockData) {
      return emptyMetrics(building.id, siteId, isBound);
    }

    return {
      buildingId: building.id,
      siteId,
      isBound,
      hasData: true,
      source: 'live',
      currentPowerKw: overview.currentPowerKw,
      todayEnergyKwh: overview.dailyEnergyKwh,
      lifetimeEnergyKwh: overview.lifetimeEnergyKwh,
      // Capacity comes from the API's peak power once mapped, so that in live
      // mode every figure on the pin traces back to a real reading.
      capacityKwp: overview.peakPowerKwp,
      lastUpdateTime: overview.lastUpdateTime,
    };
  }

  // --- mock mode ---
  // The building's own figures are used rather than the bound mock overview:
  // they are what the live simulation ticks, so the pins, the regional totals
  // and the simulated clock all move together instead of drifting apart.
  return {
    buildingId: building.id,
    siteId,
    isBound,
    hasData: true,
    source: 'mock',
    currentPowerKw: building.currentPowerKw,
    todayEnergyKwh: building.todayEnergyKwh,
    lifetimeEnergyKwh: building.lifetimeEnergyKwh,
    capacityKwp: building.capacityKwp,
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
 * Only reporting sites contribute. If none report, every total is `null` rather
 * than 0 - a dashboard reading "0.0 MWp" looks like a real measurement of
 * nothing, which is exactly the wrong impression.
 */
export function aggregateSiteMetrics(
  metrics: ResolvedSiteMetrics[],
  mode: DataSourceMode
): RegionalTotals {
  const reporting = metrics.filter((m) => m.hasData);

  if (reporting.length === 0) {
    return {
      siteCount: metrics.length,
      sitesWithData: 0,
      hasData: false,
      mode,
      totalCapacityKwp: null,
      currentPowerKw: null,
      todayEnergyKwh: null,
      lifetimeEnergyKwh: null,
    };
  }

  const sum = (pick: (m: ResolvedSiteMetrics) => MetricValue): number =>
    reporting.reduce((acc, m) => acc + (pick(m) ?? 0), 0);

  return {
    siteCount: metrics.length,
    sitesWithData: reporting.length,
    hasData: true,
    mode,
    totalCapacityKwp: sum((m) => m.capacityKwp),
    currentPowerKw: Math.round(sum((m) => m.currentPowerKw) * 10) / 10,
    todayEnergyKwh: Math.round(sum((m) => m.todayEnergyKwh) * 10) / 10,
    lifetimeEnergyKwh: sum((m) => m.lifetimeEnergyKwh),
  };
}
