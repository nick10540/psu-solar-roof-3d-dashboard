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
 * Live sites (สุราษฎร์ธานี and ภูเก็ต have no site ID yet and stay unbound):
 *   4956359 หาดใหญ่ | 4821237 ตรัง | 4947126 ปัตตานี
 */

import {
  SolarEdgeRawSite,
  SolarEdgeOverviewResponse,
  SolarEdgeTransformedOverview,
  SolarEdgeQuotaInfo,
  SolarEdgeBackendStatus,
  SolarEdgeSiteStatus,
  BuildingSiteBinding
} from '../types';

// Constants
/**
 * Same-origin path. In dev, Vite proxies it to http://localhost:8787; in
 * production put the backend behind the same host (Nginx/Caddy location block)
 * so this stays same-origin and no CORS is involved.
 */
const BACKEND_BASE_URL = '/api/solaredge';
const DAILY_QUOTA_LIMIT = 300; // SolarEdge daily request limit policy

/**
 * Cache TTL, deliberately just under the 5-minute dashboard poll.
 *
 * The poller runs on a 5-minute tick and asks for data WITHOUT forceRefresh.
 * A 4.5-minute TTL means each tick reliably finds the cache expired and takes
 * exactly one fetch, while an accidental double-render, a manual refresh or a
 * page reload inside the same window is served from cache for free.
 */
const CACHE_TTL_MS = 4.5 * 60 * 1000;

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

/** Live SolarEdge site IDs, keyed by the dashboard's building id. */
export const LIVE_SITE_IDS = {
  TRANG: 4821237,
  HATYAI: 4956359,
  PATTANI: 4947126,
} as const;

// 5 MEA Solar Roof Regional Sites for Demo / Mock Mode & API Ready
export const MOCK_SOLAREDGE_SITES: SolarEdgeRawSite[] = [
  {
    id: 2849101,
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
      if (lastTimestamp && Date.now() - lastTimestamp < CACHE_TTL_MS) {
        isCacheActive = true;
      }
    }

    return {
      callsMadeToday: count,
      dailyQuotaLimit: DAILY_QUOTA_LIMIT,
      remainingCalls: Math.max(0, DAILY_QUOTA_LIMIT - count),
      cacheTtlMinutes: Math.round((CACHE_TTL_MS / 60000) * 10) / 10,
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
      cacheTtlMinutes: Math.round((CACHE_TTL_MS / 60000) * 10) / 10,
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
  /** Skip the live call and serve cache when the daily budget is nearly spent. Default true. */
  respectQuotaReserve?: boolean;
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
    signal,
  } = options;

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
    !!cachedOverviews && Date.now() - cachedOverviews.timestamp < CACHE_TTL_MS;

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
    const payload = await fetchBackend(forceRefresh ? '/overview?refresh=1' : '/overview', {
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
    };

    if (!res.ok || body.ok !== true) {
      return unreachableBackend(body.message || body.error || `Backend HTTP ${res.status}`);
    }

    return {
      reachable: true,
      siteIds: body.siteIds ?? [],
      sites: body.sites ?? [],
      siteErrors: [],
      staleReason: null,
      message: body.message ?? null,
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
      // Only the three buildings with a real SolarEdge site ID are bound.
      // สุราษฎร์ธานี (1) and ภูเก็ต (2) have no site provisioned yet, so binding
      // them to a placeholder would put invented numbers on stage under a
      // "Live API" badge. Unbound, they render "ไม่มีข้อมูล" in live mode and
      // still show their simulated figures in mock mode. Add an entry here the
      // day their IDs are issued — nothing else needs to change.
      const now = new Date().toISOString();
      const defaultBindings: Record<number, BuildingSiteBinding> = {
        3: {
          buildingId: 3,
          siteId: LIVE_SITE_IDS.TRANG,
          siteName: 'MEA Solar Roof - ตรัง',
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: now,
        },
        4: {
          buildingId: 4,
          siteId: LIVE_SITE_IDS.HATYAI,
          siteName: 'MEA Solar Roof - หาดใหญ่',
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: now,
        },
        5: {
          buildingId: 5,
          siteId: LIVE_SITE_IDS.PATTANI,
          siteName: 'MEA Solar Roof - ปัตตานี',
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: now,
        },
      };
      return defaultBindings;
    }
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveBuildingSiteBinding(binding: BuildingSiteBinding): Record<number, BuildingSiteBinding> {
  try {
    const current = loadBuildingSiteBindings();
    if (binding.isBound && binding.siteId !== null) {
      current[binding.buildingId] = binding;
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
