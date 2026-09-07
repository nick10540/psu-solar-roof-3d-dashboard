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

import { DEFAULT_SITE_MULTIPLIER, siteMultiplierFor } from '../config/siteMultiplier';

import { CO2_KG_PER_KWH } from '../utils/energyEquivalents';

import { newestTimestamp } from '../utils/relativeTime';

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
  /**
   * The per-site multiplier already APPLIED to every measured figure above.
   *
   * Carried on the result so a surface that prints something the resolver does
   * not carry - monthly energy, or the raw W / Wh the API reported - can scale
   * it the same way instead of landing beside a headline it disagrees with.
   * `1` means untouched, which is every site until siteMultiplier.ts says
   * otherwise. Capacity is excluded by design; see that file.
   */
  multiplier: number;
  lastUpdateTime: string | null;
  /**
   * When these figures were MEASURED, in epoch ms — not when they were fetched.
   *
   * Parsed from the same SolarEdge stamp `lastUpdateTime` is formatted from, so
   * a card can print an age that ticks on its own between polls. `null` means
   * the pin has nothing to state an age for, and the age line is then omitted
   * rather than defaulted to "just now". See utils/relativeTime.ts.
   */
  lastUpdateAtMs: number | null;
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
  /**
   * When the freshest pin feeding these totals was measured, in epoch ms.
   *
   * The freshest rather than the oldest, matching the per-pin rule below: the
   * band is a sum across every reporting site, and dating it by the one site
   * that reports least often would make the whole headline look stale.
   */
  lastUpdateAtMs: number | null;
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
  capacityKwp: MetricValue = null,
  multiplier: number = DEFAULT_SITE_MULTIPLIER
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
    // Survives "no data" for the same reason capacity does: it is configuration,
    // not a reading, so a surface that scales its own derived figure still knows
    // the factor even while this pin has nothing to show.
    multiplier,
    lastUpdateTime: null,
    lastUpdateAtMs: null,
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

  /**
   * Display multiplier for this site, applied to every MEASURED figure below
   * and to neither `capacityKwp` above nor anything else that is a spec.
   *
   * Applied here rather than in each card because this function is already the
   * single place that decides what a site may show: scaling downstream would
   * mean the map pin, the sub-page and the regional band each had their own
   * chance to forget, which is the exact class of drift this file exists to
   * stop. `1` for every site until siteMultiplier.ts is edited.
   */
  const multiplier = siteMultiplierFor(building.code);

  if (mode === 'live') {
    const live = siteIds
      .map((id) => overviews[id])
      .filter((ov): ov is SolarEdgeTransformedOverview => Boolean(ov) && !ov.isMockData);

    // No mapping, no readings, or only simulated payloads -> nothing measured.
    // One dead ID among three does NOT blank the pin: the sites that did report
    // are still real, and their sum is still the best available total.
    if (live.length === 0) {
      return emptySiteMetrics(building.id, primaryId, isBound, siteIds, capacityKwp, multiplier);
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
      // Scaled BEFORE rounding, so the figure on screen is the rounded product
      // rather than a product of rounded parts - the two drift apart once a
      // multiplier is large enough to magnify the 0.05 kW that rounding drops.
      currentPowerKw: Math.round(sum((ov) => ov.currentPowerKw) * multiplier * 10) / 10,
      todayEnergyKwh: Math.round(sum((ov) => ov.dailyEnergyKwh) * multiplier * 10) / 10,
      lifetimeEnergyKwh: sum((ov) => ov.lifetimeEnergyKwh) * multiplier,
      capacityKwp,
      // CO2 scales with the energy it represents. Leaving SolarEdge's own figure
      // unscaled beside a scaled lifetime would put two numbers on the same card
      // that no longer divide into the portal's 0.392 kg/kWh.
      co2Kg:
        co2Values.length > 0
          ? co2Values.reduce((a, b) => a + b, 0) * multiplier
          : null,
      multiplier,
      lastUpdateTime: newestLabel,
      // The same stamp `newestLabel` was formatted from, as a number the cards
      // can age against a live clock. Re-parsed from the raw values rather than
      // from the Thai label above, which is display text and lossy.
      lastUpdateAtMs: newestTimestamp(live.map((ov) => ov.rawTimestamp)),
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
    // Scaled in mock mode too. The multiplier describes the SITE, not the feed,
    // so a card must not change value when an operator flips the data source -
    // that would make the switch look like it moved the readings.
    currentPowerKw: building.currentPowerKw * multiplier,
    todayEnergyKwh: building.todayEnergyKwh * multiplier,
    lifetimeEnergyKwh: building.lifetimeEnergyKwh * multiplier,
    capacityKwp,
    co2Kg: building.lifetimeEnergyKwh * multiplier * CO2_KG_PER_KWH,
    multiplier,
    lastUpdateTime: null,
    /**
     * "Now", and genuinely so.
     *
     * The simulator advances `building` on its own interval and this resolver
     * re-runs on exactly that change, so the moment this line executes IS the
     * moment the mock figures were produced. Freezing when the simulation is
     * paused is the point: the age then climbs, which is the honest reading of
     * a simulator that has stopped ticking.
     */
    lastUpdateAtMs: Date.now(),
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
 * SolarEdge site id -> the multiplier of the pin it is bound to.
 *
 * For the one path that does NOT go through the resolver: App aggregates the
 * raw overviews itself to fill the month / year fields of the glassmorphic
 * overview cards, which ResolvedSiteMetrics does not carry. That loop is keyed
 * by SolarEdge site id and the multiplier is keyed by building code, so this
 * walks the bindings once to join the two.
 *
 * An id nobody has bound is simply absent - the caller falls back to 1, which
 * is what an unmapped site should show anyway.
 */
export function siteMultipliersBySiteId(
  buildings: BuildingInfo[],
  bindings: Record<number, BuildingSiteBinding>
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const building of buildings) {
    const multiplier = siteMultiplierFor(building.code);
    for (const id of bindingSiteIds(bindings[building.id])) {
      out[id] = multiplier;
    }
  }
  return out;
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
      lastUpdateAtMs: null,
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
    lastUpdateAtMs: reporting.reduce<number | null>(
      (newest, m) =>
        m.lastUpdateAtMs !== null && (newest === null || m.lastUpdateAtMs > newest)
          ? m.lastUpdateAtMs
          : newest,
      null
    ),
  };
}
