/**
 * Type definitions for MEA Solar Roof Interactive 3D Dashboard
 * Configured for 5 Regional Sites (สุราษฎร์ธานี, ภูเก็ต, ตรัง, หาดใหญ่, ปัตตานี)
 * Enhanced with Google Earth 3D Mode & SolarEdge Monitoring API v1.0 specifications
 */

export interface InverterString {
  stringId: string;
  voltageV: number;
  currentA: number;
  powerW: number;
}

export interface InverterInfo {
  id: string;
  model: string;
  powerKw: number;
  maxPowerKw: number;
  efficiency: number;
  temperatureC: number;
  status: 'normal' | 'warning' | 'offline';
  strings: InverterString[];
}

export type ViewMode3D = 'campus' | 'building' | 'solar-mesh' | 'heatmap';
export type AppNavigationMode = 'main-map' | 'site-detail';

// SolarEdge Raw API Response Types (from SolarEdge Monitoring API Specification)
export interface SolarEdgeRawSite {
  id: number;
  name: string;
  accountId: number;
  status: 'Active' | 'Pending' | 'Disabled';
  peakPower: number; // in kWp
  lastUpdateTime: string; // YYYY-MM-DD
  currency: string;
  installationDate: string;
  ptoDate: string | null;
  notes: string;
  type: string;
  location: {
    country: string;
    city: string;
    address: string;
    zip: string;
    timeZone: string;
  };
  primaryModule: {
    manufacturerName: string;
    modelName: string;
    maximumPower: number;
  };
}

export interface SolarEdgeSitesListResponse {
  sites: {
    count: number;
    total: number;
    site: SolarEdgeRawSite[];
  };
}

export interface SolarEdgeRawEnergyMetric {
  energy: number; // in Watt-hours (Wh)
  revenue?: number;
}

export interface SolarEdgeRawCurrentPower {
  power: number; // in Watts (W)
}

export interface SolarEdgeRawOverview {
  lastUpdateTime: string; // YYYY-MM-DD HH:mm:ss
  lifetimeData: SolarEdgeRawEnergyMetric;
  lastYearData: SolarEdgeRawEnergyMetric;
  lastMonthData: SolarEdgeRawEnergyMetric;
  lastDayData: SolarEdgeRawEnergyMetric;
  currentPower: SolarEdgeRawCurrentPower;
  measuredBy: string;
  /** Cumulative CO2 avoided in kg, from /environmental-benefits. */
  co2Kg?: number | null;
}

export interface SolarEdgeOverviewResponse {
  overview: SolarEdgeRawOverview;
}

// Transformed SolarEdge Overview for Dashboard Consumption (Clean Units)
export interface SolarEdgeTransformedOverview {
  siteId: number;
  siteName: string;
  peakPowerKwp: number;
  status: 'Active' | 'Pending' | 'Disabled';
  // Transformed Unit Values
  currentPowerW: number;
  currentPowerKw: number; // power (W) / 1000
  dailyEnergyWh: number;
  dailyEnergyKwh: number; // lastDayData.energy (Wh) / 1000
  monthlyEnergyWh: number;
  monthlyEnergyKwh: number; // lastMonthData.energy (Wh) / 1000
  monthlyEnergyMwh: number; // lastMonthData.energy (Wh) / 1,000,000
  yearlyEnergyKwh: number; // lastYearData.energy (Wh) / 1000
  yearlyEnergyMwh: number;
  lifetimeEnergyKwh: number; // lifetimeData.energy (Wh) / 1000
  lifetimeEnergyMwh: number;
  lastUpdateTime: string; // Formatted readable Thai timestamp
  rawTimestamp: string;
  isMockData: boolean;
  /**
   * Cumulative CO2 avoided in KILOGRAMS, as reported by SolarEdge.
   *
   * null when the endpoint failed. Kept in kg rather than tonnes because
   * that is the unit the SolarEdge portal shows, and the per-site card is
   * read side by side with it.
   */
  co2Kg?: number | null;
  /**
   * Today's measured power curve (quarter-hourly, kW), when the backend has it.
   *
   * Absent in mock mode and for a site with no readings. The detail page draws
   * this instead of a simulated curve so the chart cannot disagree with the
   * headline figures printed above it.
   */
  powerCurveToday?: Array<{ timestamp: string; powerKw: number }>;
}

// Building/Site to SolarEdge Site Mapping Definition
export type BindingDisplayMetric = 
  | 'currentPower'   // กำลังผลิตปัจจุบัน (kW)
  | 'dailyEnergy'    // พลังงานผลิตวันนี้ (kWh)
  | 'monthlyEnergy'  // พลังงานผลิตเดือนนี้ (kWh)
  | 'lifetimeEnergy' // พลังงานสะสมทั้งหมด (kWh)
  | 'efficiency';    // ประสิทธิภาพ

/**
 * How many SolarEdge site IDs one pin may aggregate.
 *
 * A campus can have its array split across several SolarEdge registrations, and
 * the dashboard has to present that as one number per campus. Three is the cap
 * the operators asked for.
 */
export const MAX_SITE_IDS_PER_BUILDING = 3;

export interface BuildingSiteBinding {
  buildingId: number;
  /**
   * The v5 single-ID field.
   *
   * Kept so bindings saved by an earlier build still load. `siteIds` is the
   * source of truth — read it through `bindingSiteIds()` rather than touching
   * either field directly.
   */
  siteId?: number | null;
  /**
   * SolarEdge site IDs feeding this pin, 1..MAX_SITE_IDS_PER_BUILDING.
   *
   * Every figure on the pin is the SUM across these IDs. Empty means unbound,
   * which renders as "ไม่มีข้อมูล" rather than as zero.
   */
  siteIds: number[];
  siteName?: string;
  primaryMetric: BindingDisplayMetric;
  customCapacityKwp?: number;
  isBound: boolean;
  boundAt?: string;
}

/**
 * The IDs a binding actually points at, tolerating the v5 shape.
 *
 * Duplicates are dropped: the same site listed twice would be counted twice in
 * every total, which is the one failure mode of summing that nobody would spot
 * on a big screen.
 */
export function bindingSiteIds(binding: BuildingSiteBinding | undefined): number[] {
  if (!binding || !binding.isBound) return [];
  const raw =
    binding.siteIds && binding.siteIds.length > 0
      ? binding.siteIds
      : binding.siteId != null
        ? [binding.siteId]
        : [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of raw) {
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_SITE_IDS_PER_BUILDING) break;
  }
  return out;
}

export interface BuildingInfo {
  id: number; // Site ID 1 to 5
  code: string;
  name: string; // Full Thai name e.g. สุราษฎร์ธานี
  shortName?: string;
  enName: string;
  province?: string;
  category: string;
  pinColor: 'red' | 'blue'; // 'red' = Orange/Red pin, 'blue' = Cyan/Blue pin
  color?: string;
  // Real Geographical GPS Coordinates in Southern Thailand
  lat: number;
  lng: number;
  // 2D Aerial Map Coordinates (% of map container width & height)
  mapX: number; // 0 to 100%
  mapY: number; // 0 to 100%
  // 3D Scene coordinates in regional globe model
  position: [number, number, number];
  size: [number, number, number];
  roofType?: 'flat' | 'sloped' | 'hip' | 'dome' | 'l-shape' | 'u-shape';
  // Solar PV Specs
  panelCount: number;
  capacityKwp: number; // กำลังติดตั้งจริง (kWp)
  areaM2: number;
  currentPowerKw: number; // กำลังผลิตปัจจุบัน (kW)
  todayEnergyKwh: number; // พลังงานที่ผลิตได้วันนี้ (kWh)
  lifetimeEnergyKwh: number; // พลังงานที่ผลิตได้ทั้งหมด (kWh)
  inverterCount: number;
  inverters: InverterInfo[];
  status: 'normal' | 'warning' | 'offline';
  efficiencyRatio: number; // Percentage e.g. 98.6
  // Active SolarEdge Binding info (if mapped)
  binding?: BuildingSiteBinding;
}

export interface SolarEdgeQuotaInfo {
  callsMadeToday: number;
  dailyQuotaLimit: number; // 300 calls/day per SolarEdge policy
  remainingCalls: number;
  cacheTtlMinutes: number; // e.g. 15 minutes
  lastFetchTimestamp: number | null;
  lastFetchTimeString: string | null;
  isCacheActive: boolean;
  /**
   * Calls the backend actually made to SolarEdge today, as reported by the
   * backend itself. The browser counts its own requests to /api/solaredge,
   * which is a different (smaller) number — one browser poll fans out to one
   * upstream call per site. Null when the backend has not answered yet.
   */
  upstreamCallsToday?: number | null;
}

/** One SolarEdge site the backend is configured to read. */
export interface SolarEdgeSiteStatus {
  siteId: number;
  name: string;
}

/**
 * Backend connection state, replacing the old client-side API key.
 *
 * The credential moved server-side: the backend holds a Fleet API Key covering
 * every site, so the browser has nothing secret and nothing to configure here
 * beyond choosing live-vs-mock.
 */
export interface SolarEdgeBackendStatus {
  reachable: boolean;
  /** Site IDs the backend is configured to read. */
  siteIds: number[];
  /** Site list from /health. Empty until it has answered. */
  sites: SolarEdgeSiteStatus[];
  /** Per-site upstream failures from the last fetch. */
  siteErrors: Array<{ siteId: number; message: string }>;
  /** Set when the backend served its last good data through an outage. */
  staleReason: string | null;
  message: string | null;
  /**
   * The ceilings and cadence the BACKEND actually applied, from /health.
   *
   * Shown in the settings panel so the operator reads the real numbers rather
   * than the browser's assumption of them: the backend clamps every interval
   * it is sent, and its per-minute ceiling is what a fast cadence runs into
   * first. Null until /health has answered, and in mock mode.
   */
  limits: SolarEdgeBackendLimits | null;
}

export interface SolarEdgeBackendLimits {
  maxCallsPerMin: number;
  monthlyCallBudget: number;
  minRefreshIntervalSec: number;
  maxRefreshIntervalSec: number;
  defaultPowerIntervalSec: number;
  defaultEnergyIntervalSec: number;
}

/**
 * Floor for a refresh interval, in seconds.
 *
 * 30 s is the operator-facing minimum. It is enforced again in worker/src/
 * config.ts, because the browser's copy of this number is only a suggestion
 * once localStorage is hand-editable.
 */
export const MIN_REFRESH_INTERVAL_SEC = 30;

/** A day. Slower than this is indistinguishable from "off" on a kiosk. */
export const MAX_REFRESH_INTERVAL_SEC = 86400;

/**
 * How often one site's figures are refetched, in seconds.
 *
 * Two knobs rather than one per endpoint, because the upstream calls come in
 * two natural pairs and the split is what lets the live figures run fast
 * without dragging the expensive history along:
 *
 *   powerSec  -> /power + /energy (today)      "what is happening now"
 *   energySec -> /energy?MONTH + CO2           "what has accumulated"
 *
 * Each pair costs 2 upstream calls per site per tick. The settings panel does
 * that arithmetic on screen against the ceilings the backend reports, because
 * the 30 s floor is affordable per minute (four sites = 32/min against 50) and
 * ruinous per month (~46k/day against a 100k budget) — two limits that a
 * number in seconds gives no hint of.
 */
export interface SiteRefreshIntervals {
  /** Real-time power + today's energy. */
  powerSec: number;
  /** Month / year / lifetime energy + CO2. */
  energySec: number;
}

export const DEFAULT_REFRESH_INTERVALS: SiteRefreshIntervals = {
  // The pre-knob cadence, kept as the default so upgrading changes nothing
  // about what the board spends until someone deliberately moves it.
  powerSec: 300,
  energySec: 1800,
};

/** Clamp one interval into [MIN, MAX], falling back when unparseable. */
export function clampRefreshIntervalSec(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_REFRESH_INTERVAL_SEC, Math.max(MIN_REFRESH_INTERVAL_SEC, Math.round(n)));
}

export interface SolarEdgeConfig {
  isConnected: boolean;
  siteId: string; // default active site
  useMock: boolean;
  lastSyncTime: string;
  pollIntervalSec: number;
  autoSyncMinutes?: number;
  /** Cadence applied to every site that has no explicit override. */
  refreshIntervals: SiteRefreshIntervals;
  /**
   * Per-site cadence, keyed by site ID as a string (JSON object keys).
   *
   * Sparse on purpose: a site the operator never touched is absent, so moving
   * the global default moves it too instead of leaving a stale copy behind.
   * `resolveSiteIntervals` in solarEdgeService.ts does the lookup.
   */
  siteRefreshIntervals?: Record<string, SiteRefreshIntervals>;
  /**
   * Show the "เพิ่มไซต์ / ลบไซต์" tools on the map. Off by default: on an
   * unattended ceremony screen a stray tap on "ลบไซต์" removes a site pin, and
   * the operator turns these on from the settings modal only while editing.
   */
  showSiteEditTools: boolean;
  /**
   * Extra SolarEdge site IDs the operator has registered by hand.
   *
   * The browser asks the backend for these on every poll, on top of whatever
   * the pins are bound to. That is what makes a freshly typed ID show up in
   * the account site list at all — until the backend has fetched it once,
   * there is nothing to bind a pin to.
   */
  extraSiteIds?: number[];
}

export interface SolarEdgeSiteOverview {
  currentPowerKw: number;
  todayEnergyKwh: number;
  monthEnergyKwh: number;
  yearEnergyKwh: number;
  lifetimeEnergyKwh: number;
  performanceRatio: number;
  co2ReducedTons: number;
  treesPlanted: number;
  oilSavedLiters: number;
  totalPanels: number;
  totalCapacityKwp: number;
  totalAreaM2: number;
  activeInverters: number;
  totalInverters: number;
  systemStatus: 'normal' | 'warning' | 'alert';
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  timeLabel: string;
  powerKw: number;
  clearSkyPotentialKw: number;
  energyKwh: number;
  irradianceWm2: number;
  ambientTempC: number;
  moduleTempC: number;
}

export type TimeRange = 'realtime' | 'day' | 'week' | 'month' | 'year';

export interface CampusWeather {
  temperatureC: number;
  condition: string;
  conditionEn: string;
  icon: string;
  humidity: number;
  uvIndex: number;
  irradianceWm2: number;
  windSpeedKmh: number;
  sunAltitudeDeg: number;
}

export interface MapViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}
