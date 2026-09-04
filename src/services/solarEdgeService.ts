/**
 * SolarEdge Client & Data Transformation Service
 *
 * ---------------------------------------------------------------------------
 * THE BROWSER NO LONGER TALKS TO SOLAREDGE.
 *
 * SolarEdge retired the `?api_key=` scheme. The replacement is a Fleet API
 * Key sent as a header — a long-lived credential that must never reach a
 * browser bundle. It lives in the backend under worker/:
 *
 *   browser  ──GET /api/solaredge/overview──▶  worker/  ──X-API-Key──▶  SolarEdge
 *
 * The backend assembles each site's readings from the v2 series endpoints and
 * hands back one payload. This file is now purely: fetch that one endpoint,
 * cache, transform units, and persist bindings.
 * ---------------------------------------------------------------------------
 *
 * Features:
 * 1. Single backend call per refresh (/api/solaredge/overview)
 * 2. SWR / LocalStorage caching so a reload or a second tab costs nothing
 * 3. Unit Transformation (W -> kW, Wh -> kWh/MWh, Timestamp formatting)
 * 4. Building-Site Dynamic Binding persistence
 * 5. AbortSignal support so an in-flight poll can be cancelled on unmount
 *
 * Live sites (ภูเก็ต has no site ID yet and stays unbound):
 *   4956359 หาดใหญ่ | 4821237 ตรัง | 4947126 ปัตตานี | 4817295 สุราษฎร์ธานี
 */

import {
  SolarEdgeRawSite,
  SolarEdgeOverviewResponse,
  SolarEdgeTransformedOverview,
  SolarEdgeQuotaInfo,
  SolarEdgeBackendStatus,
  SolarEdgeSiteStatus,
  BuildingSiteBinding,
  bindingSiteIds,
  SolarEdgeConfig,
  SolarEdgeBackendLimits,
  SiteRefreshIntervals,
  DEFAULT_REFRESH_INTERVALS,
  clampRefreshIntervalSec,
  MIN_REFRESH_INTERVAL_SEC
} from '../types';
import { INITIAL_SOLAREDGE_CONFIG } from '../data/mockSolarData';

// Constants
/**
 * Same-origin path. In dev, Vite proxies it to http://localhost:8787; in
 * production put the backend behind the same host (Nginx/Caddy location block)
 * so this stays same-origin and no CORS is involved.
 */
const BACKEND_BASE_URL = '/api/solaredge';
const DAILY_QUOTA_LIMIT = 300; // SolarEdge daily request limit policy

/**
 * How long the browser reuses its own last payload.
 *
 * Follows the FASTEST configured interval instead of a fixed 4.5 minutes: now
 * that cadence is an operator setting, a hard-coded TTL would silently cap a
 * 30-second board at one refresh every 4.5 minutes and the knob would look
 * broken. Shaved slightly so a tick reliably finds the cache expired rather
 * than landing on the exact boundary.
 *
 * Protecting the upstream budget is no longer this cache's job — the backend's
 * per-endpoint TTLs own that, and they are shared across every tab. All this
 * has to do is stop a double render or a rapid remount re-requesting.
 */
let clientCacheTtlMs = DEFAULT_REFRESH_INTERVALS.powerSec * 1000 * 0.9;

/** The shortest interval any site is configured for, in seconds. */
export function fastestIntervalSec(config: SolarEdgeConfig): number {
  const candidates: number[] = [
    config.refreshIntervals?.powerSec ?? DEFAULT_REFRESH_INTERVALS.powerSec,
    config.refreshIntervals?.energySec ?? DEFAULT_REFRESH_INTERVALS.energySec,
  ];

  for (const entry of Object.values(config.siteRefreshIntervals ?? {})) {
    if (entry?.powerSec) candidates.push(entry.powerSec);
    if (entry?.energySec) candidates.push(entry.energySec);
  }

  return Math.max(MIN_REFRESH_INTERVAL_SEC, Math.min(...candidates));
}

/** The cadence in force for one site: its override, else the global default. */
export function resolveSiteIntervals(
  config: SolarEdgeConfig,
  siteId: number
): SiteRefreshIntervals {
  const base = config.refreshIntervals ?? DEFAULT_REFRESH_INTERVALS;
  const override = config.siteRefreshIntervals?.[String(siteId)];
  if (!override) return base;

  return {
    powerSec: clampRefreshIntervalSec(override.powerSec, base.powerSec),
    energySec: clampRefreshIntervalSec(override.energySec, base.energySec),
  };
}

/**
 * Stop spending live calls once the day's remaining budget hits this floor,
 * so the ceremony can never black out from an exhausted quota. Cached data
 * keeps being served instead.
 */
const QUOTA_RESERVE = 20;

export interface SolarEdgeRequestOptions {
  signal?: AbortSignal;
}

/** Wire shape of GET /api/solaredge/overview. Mirrors worker/src/solaredge.ts. */
interface BackendOverviewPayload {
  sites: SolarEdgeRawSite[];
  overviews: Record<string, SolarEdgeOverviewResponse['overview']>;
  /** Today's quarter-hourly power curve per site, in Watts. */
  powerSeries?: Record<string, Array<{ t: string; w: number }>>;
  errors?: Array<{ siteId: number; message: string; status?: number }>;
  fetchedAt: number;
  fromCache: boolean;
  upstreamCallsToday: number;
  /** Present when the backend served its last good data through an outage. */
  staleReason?: string;
  /** Present on a backend-side failure instead of the fields above. */
  error?: string;
  message?: string;
}

class BackendError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
  }
}

/**
 * Call the backend.
 *
 * The old version raced a proxy against a direct SolarEdge call and sniffed
 * content-type to tell a real answer from an SPA fallback. None of that is
 * needed now: there is exactly one endpoint, on our own origin. A non-JSON
 * response means the backend is not running, and saying so plainly is far more
 * useful than silently reaching past it.
 */
async function fetchBackend(
  path: string,
  options: SolarEdgeRequestOptions = {}
): Promise<BackendOverviewPayload> {
  const { signal } = options;

  let res: Response;
  try {
    res = await fetch(`${BACKEND_BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new BackendError(
      'ติดต่อ backend ไม่ได้ — ตรวจสอบว่ารัน `npm run worker` อยู่หรือไม่',
      0
    );
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    throw new BackendError(
      `Backend ไม่ได้ตอบกลับเป็น JSON (HTTP ${res.status}) — เส้นทาง ${BACKEND_BASE_URL} ยังไม่ได้ต่อกับ worker/`,
      res.status
    );
  }

  const payload = (await res.json()) as BackendOverviewPayload;

  if (!res.ok) {
    throw new BackendError(
      payload.message || payload.error || `Backend ตอบกลับ HTTP ${res.status}`,
      res.status
    );
  }

  return payload;
}

// LocalStorage Keys.
//
// Bumped to v5 with the v2 migration: a v4 cache holds overviews keyed by
// the old placeholder site IDs, and a v4 binding map points buildings at them.
// Left in place they would quietly shadow the real 4956359 / 4821237 / 4947126
// readings on every machine that has run the previous build.
const STORAGE_KEY_SITES_CACHE = 'solaredge_sites_cache_v5';
const STORAGE_KEY_OVERVIEWS_CACHE = 'solaredge_overviews_cache_v5';
const STORAGE_KEY_DAILY_CALLS = 'solaredge_daily_calls_v5';
const STORAGE_KEY_BINDINGS = 'mea_solar_building_bindings_v5';
const STORAGE_KEY_CONFIG = 'mea_solar_config_v5';

/** Live SolarEdge site IDs, keyed by the dashboard's building id. */
export const LIVE_SITE_IDS = {
  TRANG: 4821237,
  HATYAI: 4956359,
  PATTANI: 4947126,
  SURAT: 4817295,
} as const;

// 5 MEA Solar Roof Regional Sites for Demo / Mock Mode & API Ready
export const MOCK_SOLAREDGE_SITES: SolarEdgeRawSite[] = [
  {
    id: 4817295,
    name: 'MEA Solar Roof - สุราษฎร์ธานี',
    accountId: 91401,
    status: 'Active',
    peakPower: 320.0,
    lastUpdateTime: '2026-08-21',
    currency: 'THB',
    installationDate: '2024-02-15',
    ptoDate: '2024-03-01',
    notes: 'Inverter SolarEdge SE100K x 3',
    type: 'Commercial Rooftop',
    location: {
      country: 'Thailand',
      city: 'Surat Thani',
      address: 'Surat Thani Regional Office, Surat Thani 84000',
      zip: '84000',
      timeZone: 'Asia/Bangkok',
    },
    primaryModule: {
      manufacturerName: 'Canadian Solar',
      modelName: 'CS3W-500MS',
      maximumPower: 500,
    },
  },
  {
    id: 2849102,
    name: 'MEA Solar Roof - ภูเก็ต',
    accountId: 91402,
    status: 'Active',
    peakPower: 450.0,
    lastUpdateTime: '2026-08-21',
    currency: 'THB',
    installationDate: '2024-01-10',
    ptoDate: '2024-02-01',
    notes: 'Inverter SolarEdge SE100K x 4, SE50K x 1',
    type: 'Commercial Rooftop',
    location: {
      country: 'Thailand',
      city: 'Phuket',
      address: 'Phuket Clean Energy Hub, Mueang Phuket 83000',
      zip: '83000',
      timeZone: 'Asia/Bangkok',
    },
    primaryModule: {
      manufacturerName: 'Canadian Solar',
      modelName: 'CS3W-500MS',
      maximumPower: 500,
    },
  },
  {
    id: 4821237,
    name: 'MEA Solar Roof - ตรัง',
    accountId: 91403,
    status: 'Active',
    peakPower: 250.0,
    lastUpdateTime: '2026-08-21',
    currency: 'THB',
    installationDate: '2024-03-20',
    ptoDate: '2024-04-01',
    notes: 'Inverter SolarEdge SE100K x 2, SE50K x 1',
    type: 'Commercial Rooftop',
    location: {
      country: 'Thailand',
      city: 'Trang',
      address: 'Trang Smart Grid Station, Mueang Trang 92000',
      zip: '92000',
      timeZone: 'Asia/Bangkok',
    },
    primaryModule: {
      manufacturerName: 'Canadian Solar',
      modelName: 'CS3W-500MS',
      maximumPower: 500,
    },
  },
  {
    id: 4956359,
    name: 'MEA Solar Roof - หาดใหญ่',
    accountId: 91404,
    status: 'Active',
    peakPower: 380.0,
    lastUpdateTime: '2026-08-21',
    currency: 'THB',
    installationDate: '2023-11-15',
    ptoDate: '2023-12-01',
    notes: 'Inverter SolarEdge SE100K x 3, SE50K x 1',
    type: 'Commercial Rooftop',
    location: {
      country: 'Thailand',
      city: 'Hatyai',
      address: '15 Karnjanavanich Rd., Kho Hong, Hat Yai, Songkhla 90110',
      zip: '90110',
      timeZone: 'Asia/Bangkok',
    },
    primaryModule: {
      manufacturerName: 'Canadian Solar',
      modelName: 'CS3W-500MS',
      maximumPower: 500,
    },
  },
  {
    id: 4947126,
    name: 'MEA Solar Roof - ปัตตานี',
    accountId: 91405,
    status: 'Active',
    peakPower: 200.0,
    lastUpdateTime: '2026-08-21',
    currency: 'THB',
    installationDate: '2024-04-05',
    ptoDate: '2024-05-01',
    notes: 'Inverter SolarEdge SE100K x 2',
    type: 'Commercial Rooftop',
    location: {
      country: 'Thailand',
      city: 'Pattani',
      address: 'Pattani Energy Center, Mueang Pattani 94000',
      zip: '94000',
      timeZone: 'Asia/Bangkok',
    },
    primaryModule: {
      manufacturerName: 'Canadian Solar',
      modelName: 'CS3W-500MS',
      maximumPower: 500,
    },
  },
];

// Helper: Format SolarEdge date string to readable Thai timestamp
export function formatSolarEdgeTimestamp(dateStr?: string): string {
  if (!dateStr) return 'กำลังเชื่อมต่อ...';
  try {
    const d = new Date(dateStr.replace(' ', 'T'));
    if (isNaN(d.getTime())) return dateStr;

    const thaiMonths = [
      'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
    ];
    const day = d.getDate();
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear() + 543;
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');

    return `${day} ${month} ${year} ${hours}:${mins}:${secs} น.`;
  } catch {
    return dateStr;
  }
}

// -------------------------------------------------------------
// Rate Limit & Daily Call Quota Tracker
// -------------------------------------------------------------
export function getDailyQuotaInfo(): SolarEdgeQuotaInfo {
  try {
    const todayKey = new Date().toISOString().split('T')[0];
    const rawCalls = localStorage.getItem(STORAGE_KEY_DAILY_CALLS);
    let count = 0;

    if (rawCalls) {
      const parsed = JSON.parse(rawCalls);
      if (parsed.date === todayKey) {
        count = parsed.count || 0;
      }
    }

    const rawCache = localStorage.getItem(STORAGE_KEY_OVERVIEWS_CACHE);
    let lastTimestamp: number | null = null;
    let isCacheActive = false;

    if (rawCache) {
      const parsedCache = JSON.parse(rawCache);
      lastTimestamp = parsedCache.timestamp || null;
      if (lastTimestamp && Date.now() - lastTimestamp < clientCacheTtlMs) {
        isCacheActive = true;
      }
    }

    return {
      callsMadeToday: count,
      dailyQuotaLimit: DAILY_QUOTA_LIMIT,
      remainingCalls: Math.max(0, DAILY_QUOTA_LIMIT - count),
      cacheTtlMinutes: Math.round((clientCacheTtlMs / 60000) * 10) / 10,
      lastFetchTimestamp: lastTimestamp,
      lastFetchTimeString: lastTimestamp ? formatSolarEdgeTimestamp(new Date(lastTimestamp).toISOString()) : null,
      isCacheActive,
      upstreamCallsToday: null,
    };
  } catch {
    return {
      callsMadeToday: 0,
      dailyQuotaLimit: DAILY_QUOTA_LIMIT,
      remainingCalls: DAILY_QUOTA_LIMIT,
      cacheTtlMinutes: Math.round((clientCacheTtlMs / 60000) * 10) / 10,
      lastFetchTimestamp: null,
      lastFetchTimeString: null,
      isCacheActive: false,
      upstreamCallsToday: null,
    };
  }
}

function incrementDailyCallCount(increment = 1) {
  try {
    const todayKey = new Date().toISOString().split('T')[0];
    const rawCalls = localStorage.getItem(STORAGE_KEY_DAILY_CALLS);
    let count = 0;

    if (rawCalls) {
      const parsed = JSON.parse(rawCalls);
      if (parsed.date === todayKey) {
        count = parsed.count || 0;
      }
    }

    count += increment;
    localStorage.setItem(STORAGE_KEY_DAILY_CALLS, JSON.stringify({ date: todayKey, count }));
  } catch (e) {
    console.error('Failed to update daily call count:', e);
  }
}

// -------------------------------------------------------------
// Part 2: Data Transformation & Mapping Function
// -------------------------------------------------------------
/**
 * Transforms raw SolarEdge Overview JSON response into dashboard-ready units
 * Path rules:
 * - Current Power: overview.currentPower.power (Watts) -> kW & W
 * - Daily Energy: overview.lastDayData.energy (Wh) -> / 1000 = kWh
 * - Monthly Energy: overview.lastMonthData.energy (Wh) -> / 1000 = kWh (or / 1000000 = MWh)
 * - Yearly Energy: overview.lastYearData.energy (Wh) -> / 1000 = kWh
 * - Lifetime Energy: overview.lifeTimeData.energy (Wh) -> / 1000 = kWh
 * - Last Update Time: overview.lastUpdateTime -> Timestamp
 */
export function transformSolarEdgeOverview(
  siteId: number,
  siteName: string,
  peakPowerKwp: number,
  status: 'Active' | 'Pending' | 'Disabled',
  rawOverview: SolarEdgeOverviewResponse['overview'],
  isMockData = false
): SolarEdgeTransformedOverview {
  const currentPowerW = rawOverview.currentPower?.power ?? 0;
  const currentPowerKw = Math.round((currentPowerW / 1000) * 10) / 10;

  const dailyEnergyWh = rawOverview.lastDayData?.energy ?? 0;
  const dailyEnergyKwh = Math.round((dailyEnergyWh / 1000) * 10) / 10;

  const monthlyEnergyWh = rawOverview.lastMonthData?.energy ?? 0;
  const monthlyEnergyKwh = Math.round((monthlyEnergyWh / 1000) * 10) / 10;
  const monthlyEnergyMwh = Math.round((monthlyEnergyWh / 1000000) * 100) / 100;

  const yearlyEnergyWh = rawOverview.lastYearData?.energy ?? 0;
  const yearlyEnergyKwh = Math.round((yearlyEnergyWh / 1000) * 10) / 10;
  const yearlyEnergyMwh = Math.round((yearlyEnergyWh / 1000000) * 100) / 100;

  const lifetimeEnergyWh = rawOverview.lifetimeData?.energy ?? 0;
  const lifetimeEnergyKwh = Math.round((lifetimeEnergyWh / 1000) * 10) / 10;
  const lifetimeEnergyMwh = Math.round((lifetimeEnergyWh / 1000000) * 100) / 100;

  const rawTimestamp = rawOverview.lastUpdateTime || new Date().toISOString();
  const lastUpdateTime = formatSolarEdgeTimestamp(rawTimestamp);

  return {
    siteId,
    siteName,
    peakPowerKwp,
    status,
    currentPowerW,
    currentPowerKw,
    dailyEnergyWh,
    dailyEnergyKwh,
    monthlyEnergyWh,
    monthlyEnergyKwh,
    monthlyEnergyMwh,
    yearlyEnergyKwh,
    yearlyEnergyMwh,
    lifetimeEnergyKwh,
    lifetimeEnergyMwh,
    lastUpdateTime,
    rawTimestamp,
    // Straight through from the backend, which read it from SolarEdge.
    co2Kg: rawOverview.co2Kg ?? null,
    isMockData,
  };
}

// Generate realistic simulated mock overview for fallback
export function generateMockSolarEdgeOverview(site: SolarEdgeRawSite): SolarEdgeTransformedOverview {
  const hour = 10.5;
  let factor = 0;
  if (hour >= 6.0 && hour <= 18.5) {
    const normalized = (hour - 6.0) / (18.5 - 6.0);
    factor = Math.pow(Math.sin(normalized * Math.PI), 1.25);
  }

  const currentPowerW = Math.round(site.peakPower * factor * 0.95 * 1000);
  const currentPowerKw = Math.round((currentPowerW / 1000) * 10) / 10;

  const dailyEnergyWh = Math.round(site.peakPower * 4.2 * 1000);
  const dailyEnergyKwh = Math.round((dailyEnergyWh / 1000) * 10) / 10;

  const monthlyEnergyWh = Math.round(site.peakPower * 115 * 1000);
  const monthlyEnergyKwh = Math.round((monthlyEnergyWh / 1000) * 10) / 10;
  const monthlyEnergyMwh = Math.round((monthlyEnergyWh / 1000000) * 100) / 100;

  const yearlyEnergyKwh = Math.round(site.peakPower * 1350 * 10) / 10;
  const yearlyEnergyMwh = Math.round((yearlyEnergyKwh / 1000) * 100) / 100;

  const lifetimeEnergyKwh = Math.round(site.peakPower * 2800 * 10) / 10;
  const lifetimeEnergyMwh = Math.round((lifetimeEnergyKwh / 1000) * 100) / 100;

  const now = new Date();
  const rawTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  return {
    siteId: site.id,
    siteName: site.name,
    peakPowerKwp: site.peakPower,
    status: site.status,
    currentPowerW,
    currentPowerKw,
    dailyEnergyWh,
    dailyEnergyKwh,
    monthlyEnergyWh,
    monthlyEnergyKwh,
    monthlyEnergyMwh,
    yearlyEnergyKwh,
    yearlyEnergyMwh,
    lifetimeEnergyKwh,
    lifetimeEnergyMwh,
    lastUpdateTime: formatSolarEdgeTimestamp(rawTimestamp),
    rawTimestamp,
    isMockData: true,
  };
}

// -------------------------------------------------------------
// Part 1: Data Fetching (via the worker/ backend — no credentials here)
// -------------------------------------------------------------
export interface FetchSitesResult {
  sites: SolarEdgeRawSite[];
  overviews: Record<number, SolarEdgeTransformedOverview>;
  isUsingCache: boolean;
  quota: SolarEdgeQuotaInfo;
  /** Backend diagnostics for the settings modal. Null in mock mode. */
  backend: SolarEdgeBackendStatus | null;
  error?: string;
}

export interface FetchAccountDataOptions extends SolarEdgeRequestOptions {
  forceRefresh?: boolean;
  useMock?: boolean;
  /**
   * The SolarEdge site IDs the dashboard actually wants.
   *
   * The union of every bound pin's IDs. Sent so the backend fetches exactly
   * what is on screen — an ID the operator typed into the binding modal is
   * not in the backend's env list, and without this it would never be read.
   * Empty leaves the backend on its own configured set.
   */
  siteIds?: number[];
  /** Skip the live call and serve cache when the daily budget is nearly spent. Default true. */
  respectQuotaReserve?: boolean;
  /**
   * The cadence the operator configured, forwarded to the backend.
   *
   * The backend — not this file — decides which upstream endpoints are due,
   * so these travel on every request rather than being applied here. Omitted
   * leaves the backend on its own env-resolved default.
   */
  refreshIntervals?: SiteRefreshIntervals;
  siteRefreshIntervals?: Record<string, SiteRefreshIntervals>;
}

/**
 * The browser's last payload, read straight from localStorage.
 *
 * Exists for the boot path: on F5 the React tree starts empty, and a page that
 * shows nothing until the network answers reads as broken on a kiosk. Returned
 * regardless of age — the caller pairs it with an immediate forced fetch, so
 * whatever this hands back is on screen for a second or two at most.
 */
export function readCachedSnapshot(): {
  sites: SolarEdgeRawSite[];
  overviews: Record<number, SolarEdgeTransformedOverview>;
  timestamp: number;
} | null {
  const sites = readCachedSites();
  const overviews = readCachedOverviews();
  if (!sites?.length || !overviews || Object.keys(overviews.data).length === 0) return null;
  return { sites, overviews: overviews.data, timestamp: overviews.timestamp };
}

function readCachedSites(): SolarEdgeRawSite[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SITES_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.data) ? (parsed.data as SolarEdgeRawSite[]) : null;
  } catch {
    return null;
  }
}

function readCachedOverviews(): {
  data: Record<number, SolarEdgeTransformedOverview>;
  timestamp: number;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OVERVIEWS_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || !parsed?.timestamp) return null;
    return parsed as { data: Record<number, SolarEdgeTransformedOverview>; timestamp: number };
  } catch {
    return null;
  }
}

function writeCache(
  sites: SolarEdgeRawSite[],
  overviews: Record<number, SolarEdgeTransformedOverview>
): void {
  try {
    const now = Date.now();
    localStorage.setItem(STORAGE_KEY_SITES_CACHE, JSON.stringify({ timestamp: now, data: sites }));
    localStorage.setItem(
      STORAGE_KEY_OVERVIEWS_CACHE,
      JSON.stringify({ timestamp: now, data: overviews })
    );
  } catch (cacheErr) {
    console.warn('Failed to save to local cache:', cacheErr);
  }
}

function backendStatusFrom(
  payload: BackendOverviewPayload,
  reachable: boolean,
  message: string | null = null
): SolarEdgeBackendStatus {
  return {
    reachable,
    siteIds: payload.sites.map((s) => s.id),
    // The site list comes from /health; a data poll has no need to ask, so
    // leave it empty and let the caller keep the last known list.
    sites: [],
    siteErrors: (payload.errors ?? []).map((e) => ({ siteId: e.siteId, message: e.message })),
    staleReason: payload.staleReason ?? null,
    message,
    // Same reasoning as `sites`: the ceilings come from /health. Left null so
    // a data poll cannot overwrite what /health reported with a guess.
    limits: null,
  };
}

function unreachableBackend(message: string): SolarEdgeBackendStatus {
  return {
    reachable: false,
    siteIds: [],
    sites: [],
    siteErrors: [],
    staleReason: null,
    message,
    limits: null,
  };
}

/**
 * Fetch the live sites and their overviews from the backend, with SWR caching,
 * a quota brake and cancellation support.
 *
 * Cost per live refresh: ONE request to our own backend. The backend decides
 * how many upstream SolarEdge calls that becomes (currently one per site,
 * itself cached for 4.5 minutes), so a second browser tab or an F5 on the
 * kiosk costs nothing upstream at all.
 *
 * There is no `apiKey` parameter any more, and deliberately no way to pass one:
 * the credential exists only inside worker/.
 */
export async function fetchSolarEdgeAccountData(
  options: FetchAccountDataOptions = {}
): Promise<FetchSitesResult> {
  const {
    forceRefresh = false,
    useMock = false,
    respectQuotaReserve = true,
    siteIds = [],
    refreshIntervals,
    siteRefreshIntervals,
    signal,
  } = options;

  // Keep the browser's own reuse window in step with the configured cadence,
  // so a 30-second board is not held back by a TTL meant for a 5-minute one.
  if (refreshIntervals) {
    const fastest = Math.min(
      refreshIntervals.powerSec,
      refreshIntervals.energySec,
      ...Object.values(siteRefreshIntervals ?? {}).flatMap((entry) =>
        [entry?.powerSec, entry?.energySec].filter((n): n is number => !!n)
      )
    );
    clientCacheTtlMs = Math.max(MIN_REFRESH_INTERVAL_SEC, fastest) * 1000 * 0.9;
  }

  // 1. Mock mode — simulated figures are the point here.
  if (useMock) {
    const mockOverviews: Record<number, SolarEdgeTransformedOverview> = {};
    MOCK_SOLAREDGE_SITES.forEach((site) => {
      mockOverviews[site.id] = generateMockSolarEdgeOverview(site);
    });

    return {
      sites: MOCK_SOLAREDGE_SITES,
      overviews: mockOverviews,
      isUsingCache: false,
      quota: getDailyQuotaInfo(),
      backend: null,
    };
  }

  // 2. SWR / LocalStorage cache
  const cachedSites = readCachedSites();
  const cachedOverviews = readCachedOverviews();
  const cacheIsFresh =
    !!cachedOverviews && Date.now() - cachedOverviews.timestamp < clientCacheTtlMs;

  if (!forceRefresh && cachedSites && cachedOverviews && cacheIsFresh) {
    return {
      sites: cachedSites,
      overviews: cachedOverviews.data,
      isUsingCache: true,
      quota: getDailyQuotaInfo(),
      backend: null,
    };
  }

  // 3. Quota brake. Serving slightly stale data beats an empty dashboard
  //    on stage because the day's budget ran out at lunchtime.
  const currentQuota = getDailyQuotaInfo();
  if (respectQuotaReserve && currentQuota.remainingCalls <= QUOTA_RESERVE) {
    console.warn(
      `SolarEdge daily quota nearly exhausted (${currentQuota.remainingCalls} left) - serving cached data.`
    );
    if (cachedSites && cachedOverviews) {
      return {
        sites: cachedSites,
        overviews: cachedOverviews.data,
        isUsingCache: true,
        quota: currentQuota,
        backend: null,
        error: 'โควตา SolarEdge API ใกล้หมด กำลังแสดงข้อมูลจากแคช',
      };
    }
  }

  try {
    incrementDailyCallCount(1);
    const params = new URLSearchParams();
    if (forceRefresh) params.set('refresh', '1');
    if (siteIds.length > 0) params.set('sites', siteIds.join(','));

    // Cadence travels on every request, not just when it changes: the backend
    // holds it in module memory, and on Cloudflare the isolate that serves the
    // next poll may never have seen the one that carried the setting.
    if (refreshIntervals) {
      params.set('powerSec', String(refreshIntervals.powerSec));
      params.set('energySec', String(refreshIntervals.energySec));
    }

    const overrides = Object.entries(siteRefreshIntervals ?? {})
      .filter(([id]) => Number.isInteger(Number(id)) && Number(id) > 0)
      .map(([id, iv]) => `${id}:${iv.powerSec}:${iv.energySec}`);
    if (overrides.length > 0) params.set('siteIntervals', overrides.join(','));

    const query = params.toString();
    const payload = await fetchBackend(query ? `/overview?${query}` : '/overview', {
      signal,
    });

    const sites = payload.sites ?? [];
    if (sites.length === 0) {
      throw new BackendError('Backend ไม่ได้ส่งรายชื่อไซต์กลับมา', 502);
    }

    // Transform every overview the backend actually returned. A site the
    // backend could not read is simply ABSENT here — never a simulated
    // stand-in — so its pin renders "ไม่มีข้อมูล" instead of a fabrication.
    const overviewsRecord: Record<number, SolarEdgeTransformedOverview> = {};
    sites.forEach((site) => {
      const raw = payload.overviews?.[String(site.id)];
      if (!raw) return;
      const transformed = transformSolarEdgeOverview(
        site.id,
        site.name,
        site.peakPower,
        site.status,
        raw,
        false
      );

      const curve = payload.powerSeries?.[String(site.id)];
      if (curve?.length) {
        transformed.powerCurveToday = curve.map((p) => ({
          timestamp: p.t,
          powerKw: Math.round((p.w / 1000) * 10) / 10,
        }));
      }

      overviewsRecord[site.id] = transformed;
    });

    // Only persist a round that produced at least one reading. Caching a total
    // outage would hand the next reload an empty dashboard for 4.5 minutes.
    if (Object.keys(overviewsRecord).length > 0) {
      writeCache(sites, overviewsRecord);
    }

    const quota = getDailyQuotaInfo();
    quota.upstreamCallsToday = payload.upstreamCallsToday ?? null;

    // Per-site failures are surfaced, not swallowed: two green pins and one
    // silent gap is exactly the state somebody needs to be told about.
    const siteErrors = payload.errors ?? [];
    const errorMsg = payload.staleReason
      ? `Backend กำลังเสิร์ฟข้อมูลล่าสุดที่ยังใช้ได้ (${payload.staleReason})`
      : siteErrors.length > 0
        ? `ดึงข้อมูลไม่สำเร็จ ${siteErrors.length} ไซต์: ${siteErrors.map((e) => e.siteId).join(', ')}`
        : undefined;

    return {
      sites,
      overviews: overviewsRecord,
      isUsingCache: payload.fromCache === true,
      quota,
      backend: backendStatusFrom(payload, true),
      error: errorMsg,
    };
  } catch (error) {
    // A cancelled poll is normal (unmount / config change) — surface it so the
    // caller can drop the result instead of treating it as a data failure.
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }

    const errorMsg =
      error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ SolarEdge backend';
    console.error('SolarEdge backend fetch failed:', errorMsg);

    // Prefer the last good data over nothing: on a live dashboard a
    // five-minute-old real reading is still a real reading.
    if (cachedSites && cachedOverviews) {
      return {
        sites: cachedSites,
        overviews: cachedOverviews.data,
        isUsingCache: true,
        quota: getDailyQuotaInfo(),
        backend: unreachableBackend(errorMsg),
        error: errorMsg,
      };
    }

    // NO MOCK FALLBACK IN LIVE MODE.
    //
    // A failed connection used to produce a dashboard full of confident,
    // entirely invented figures — indistinguishable from real ones on a 72"
    // screen. Live mode reports emptiness honestly and the UI renders
    // "ไม่มีข้อมูล". Simulated numbers appear only when mock mode is explicitly on.
    return {
      sites: [],
      overviews: {},
      isUsingCache: false,
      quota: getDailyQuotaInfo(),
      backend: unreachableBackend(errorMsg),
      error: errorMsg,
    };
  }
}

/**
 * Ask the backend for its own diagnostics (token TTL, configured site IDs).
 *
 * Used by the settings modal only, so a routine poll never pays for it.
 */
export async function fetchBackendHealth(
  options: SolarEdgeRequestOptions = {}
): Promise<SolarEdgeBackendStatus> {
  try {
    const res = await fetch(`${BACKEND_BASE_URL}/health`, {
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      return unreachableBackend(
        'Backend ไม่ตอบกลับเป็น JSON — ยังไม่ได้รัน worker/ หรือ proxy ตั้งค่าไม่ถูกต้อง'
      );
    }

    const body = (await res.json()) as {
      ok?: boolean;
      siteIds?: number[];
      sites?: SolarEdgeSiteStatus[];
      upstreamCallsToday?: number;
      message?: string;
      error?: string;
      maxCallsPerMin?: number;
      monthlyCallBudget?: number;
      minRefreshIntervalSec?: number;
      maxRefreshIntervalSec?: number;
      defaultPowerIntervalSec?: number;
      defaultEnergyIntervalSec?: number;
    };

    if (!res.ok || body.ok !== true) {
      return unreachableBackend(body.message || body.error || `Backend HTTP ${res.status}`);
    }

    // Only present from a backend new enough to report them. An older one
    // leaves this null and the settings panel says so rather than inventing
    // ceilings it cannot vouch for.
    const limits: SolarEdgeBackendLimits | null =
      typeof body.maxCallsPerMin === 'number' && typeof body.monthlyCallBudget === 'number'
        ? {
            maxCallsPerMin: body.maxCallsPerMin,
            monthlyCallBudget: body.monthlyCallBudget,
            minRefreshIntervalSec: body.minRefreshIntervalSec ?? MIN_REFRESH_INTERVAL_SEC,
            maxRefreshIntervalSec: body.maxRefreshIntervalSec ?? 86400,
            defaultPowerIntervalSec:
              body.defaultPowerIntervalSec ?? DEFAULT_REFRESH_INTERVALS.powerSec,
            defaultEnergyIntervalSec:
              body.defaultEnergyIntervalSec ?? DEFAULT_REFRESH_INTERVALS.energySec,
          }
        : null;

    return {
      reachable: true,
      siteIds: body.siteIds ?? [],
      sites: body.sites ?? [],
      siteErrors: [],
      staleReason: null,
      message: body.message ?? null,
      limits,
    };
  } catch (err) {
    if (options.signal?.aborted) throw err;
    return unreachableBackend('ติดต่อ backend ไม่ได้ — ตรวจสอบว่ารัน `npm run worker` อยู่หรือไม่');
  }
}

// -------------------------------------------------------------
// Part 3: Building ↔ Site Mapping Persistence
// -------------------------------------------------------------
export function loadBuildingSiteBindings(): Record<number, BuildingSiteBinding> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BINDINGS);
    if (!raw) {
      // Default bindings.
      //
      // Only the four buildings with a real SolarEdge site ID are bound.
      // ภูเก็ต (2) has no site provisioned yet, so binding it to a placeholder
      // would put invented numbers on stage under a "Live API" badge. Unbound,
      // it renders "ไม่มีข้อมูล" in live mode and still shows its simulated
      // figures in mock mode.
      //
      // These are only a starting point now: the operator can type any IDs into
      // the binding modal, up to MAX_SITE_IDS_PER_BUILDING per pin, and that
      // choice is what persists here.
      const now = new Date().toISOString();
      const seed = (
        buildingId: number,
        siteId: number,
        siteName: string
      ): BuildingSiteBinding => ({
        buildingId,
        siteId,
        siteIds: [siteId],
        siteName,
        primaryMetric: 'currentPower',
        isBound: true,
        boundAt: now,
      });

      return {
        1: seed(1, LIVE_SITE_IDS.SURAT, 'MEA Solar Roof - สุราษฎร์ธานี'),
        3: seed(3, LIVE_SITE_IDS.TRANG, 'MEA Solar Roof - ตรัง'),
        4: seed(4, LIVE_SITE_IDS.HATYAI, 'MEA Solar Roof - หาดใหญ่'),
        5: seed(5, LIVE_SITE_IDS.PATTANI, 'MEA Solar Roof - ปัตตานี'),
      };
    }

    // Migrate in place. A v5 record carries `siteId` and no `siteIds`; reading
    // it as multi-ID without this would leave every pin unbound after upgrade.
    const parsed = JSON.parse(raw) as Record<number, BuildingSiteBinding>;
    for (const key of Object.keys(parsed)) {
      const b = parsed[Number(key)];
      if (!b) continue;
      if (!Array.isArray(b.siteIds)) {
        b.siteIds = b.siteId != null ? [b.siteId] : [];
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

export function saveBuildingSiteBinding(binding: BuildingSiteBinding): Record<number, BuildingSiteBinding> {
  try {
    const current = loadBuildingSiteBindings();
    // `isBound` alone is not enough: a binding saved with every ID field
    // cleared has nothing to fetch, and keeping it would leave the pin claiming
    // to be live while showing no data.
    const ids = bindingSiteIds(binding);
    if (binding.isBound && ids.length > 0) {
      current[binding.buildingId] = {
        ...binding,
        siteIds: ids,
        // Keep the legacy field pointing at the first ID so an older build
        // rolled back onto this storage still shows something sensible.
        siteId: ids[0],
      };
    } else {
      delete current[binding.buildingId];
    }
    localStorage.setItem(STORAGE_KEY_BINDINGS, JSON.stringify(current));
    return current;
  } catch (err) {
    console.error('Failed to save building binding:', err);
    return loadBuildingSiteBindings();
  }
}

// -------------------------------------------------------------
// Dashboard Config Persistence (data source mode, poll cadence)
// -------------------------------------------------------------
/**
 * Load the operator's saved dashboard configuration.
 *
 * Without this, the settings modal's "save" only ever updated in-memory React
 * state — App.tsx seeded `config` from the hard-coded INITIAL_SOLAREDGE_CONFIG
 * on every mount, so a reload silently dropped the operator back to Mock mode.
 * On a kiosk that reloads unattended, that turns a live board into a simulated
 * one with nobody there to notice.
 *
 * No credential is involved: since the v2 migration the Fleet API Key lives in
 * the backend (worker/), so what is stored here is only the data-source mode,
 * the poll cadence and the default site.
 *
 * Merged over the defaults rather than returned as-is, so a field added to
 * SolarEdgeConfig in a later release still has a sane value when reading a
 * config object written by an older build.
 */
export function loadSolarEdgeConfig(): SolarEdgeConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return { ...INITIAL_SOLAREDGE_CONFIG };
    const parsed = JSON.parse(raw);
    return normaliseRefreshConfig({ ...INITIAL_SOLAREDGE_CONFIG, ...parsed });
  } catch (err) {
    console.error('Failed to load saved dashboard config, using defaults:', err);
    return { ...INITIAL_SOLAREDGE_CONFIG };
  }
}

export function saveSolarEdgeConfig(config: SolarEdgeConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(normaliseRefreshConfig(config)));
  } catch (err) {
    console.error('Failed to save dashboard config:', err);
  }
}

/**
 * Force every persisted interval back inside [MIN, MAX], on the way in AND out.
 *
 * A config written by an older build has no `refreshIntervals` at all, and a
 * hand-edited localStorage entry can hold anything — including a 1, which
 * would have this board asking SolarEdge for four sites every second. The
 * backend clamps too; this is so the settings panel and the poll timer agree
 * with what the backend will actually do.
 */
function normaliseRefreshConfig(config: SolarEdgeConfig): SolarEdgeConfig {
  const base = config.refreshIntervals ?? DEFAULT_REFRESH_INTERVALS;
  const refreshIntervals: SiteRefreshIntervals = {
    powerSec: clampRefreshIntervalSec(base.powerSec, DEFAULT_REFRESH_INTERVALS.powerSec),
    energySec: clampRefreshIntervalSec(base.energySec, DEFAULT_REFRESH_INTERVALS.energySec),
  };

  const siteRefreshIntervals: Record<string, SiteRefreshIntervals> = {};
  for (const [id, entry] of Object.entries(config.siteRefreshIntervals ?? {})) {
    const siteId = Number(id);
    if (!Number.isInteger(siteId) || siteId <= 0 || !entry) continue;
    siteRefreshIntervals[id] = {
      powerSec: clampRefreshIntervalSec(entry.powerSec, refreshIntervals.powerSec),
      energySec: clampRefreshIntervalSec(entry.energySec, refreshIntervals.energySec),
    };
  }

  return { ...config, refreshIntervals, siteRefreshIntervals };
}
