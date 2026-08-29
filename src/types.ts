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
}

// Building/Site to SolarEdge Site Mapping Definition
export type BindingDisplayMetric = 
  | 'currentPower'   // กำลังผลิตปัจจุบัน (kW)
  | 'dailyEnergy'    // พลังงานผลิตวันนี้ (kWh)
  | 'monthlyEnergy'  // พลังงานผลิตเดือนนี้ (kWh / MWh)
  | 'lifetimeEnergy' // พลังงานสะสมทั้งหมด (MWh)
  | 'efficiency';    // ประสิทธิภาพ

export interface BuildingSiteBinding {
  buildingId: number;
  siteId: number | null; // null means using simulated mock
  siteName?: string;
  primaryMetric: BindingDisplayMetric;
  customCapacityKwp?: number;
  isBound: boolean;
  boundAt?: string;
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

/** Authorization state of one SolarEdge site, as reported by the backend. */
export interface SolarEdgeSiteAuthStatus {
  siteId: number;
  name: string;
  authorized: boolean;
  /** Seconds left on this site's cached access token (2 h when fresh). */
  accessTokenTtlSec: number | null;
}

/**
 * Backend connection state, replacing the old client-side API key.
 *
 * Credentials moved server-side with the switch to SolarEdge Connect: the
 * browser holds nothing secret, so the only thing left to configure here is
 * live-vs-mock, plus kicking off the consent flow.
 *
 * A SolarEdge grant covers ONE site, so authorization is tracked per site
 * rather than as a single account-wide flag.
 */
export interface SolarEdgeBackendStatus {
  reachable: boolean;
  /** Site IDs the backend is configured to read. */
  siteIds: number[];
  /** Per-site authorization state. Empty until /health has answered. */
  sites: SolarEdgeSiteAuthStatus[];
  authorizedCount: number;
  totalSites: number;
  /** Per-site upstream failures from the last fetch. */
  siteErrors: Array<{ siteId: number; message: string; needsAuthorization?: boolean }>;
  /** Set when the backend served its last good data through an outage. */
  staleReason: string | null;
  message: string | null;
}

export interface SolarEdgeConfig {
  isConnected: boolean;
  siteId: string; // default active site
  useMock: boolean;
  lastSyncTime: string;
  pollIntervalSec: number;
  autoSyncMinutes?: number;
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
