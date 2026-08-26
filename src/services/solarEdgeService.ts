/**
 * SolarEdge Monitoring API Client & Data Transformation Service
 * Reference: SolarEdge Monitoring API Specification (https://knowledge-center.solaredge.com/sites/kc/files/se_monitoring_api.pdf)
 * 
 * Features:
 * 1. Efficient Site List Fetching (/sites/list?size=5&api_key={API_KEY}), cached per session
 * 2. BULK overview fetching: /sites/{id1,id2,...}/overview -> 1 call for all 5 sites
 *    (per-site Promise.all remains as an automatic fallback)
 * 3. 300 Calls/Day Rate Limit Protection with SWR/LocalStorage caching + a reserve floor
 * 4. Unit Transformation (W -> kW, Wh -> kWh/MWh, Timestamp formatting)
 * 5. Building-Site Dynamic Binding persistence
 * 6. AbortSignal support so an in-flight poll can be cancelled on unmount
 *
 * Daily budget with the dashboard's 5-minute poll (12 h event):
 *   1 site-list call + 144 bulk overview calls = ~145 of the 300/day allowance.
 */

import { 
  SolarEdgeRawSite, 
  SolarEdgeSitesListResponse, 
  SolarEdgeOverviewResponse, 
  SolarEdgeTransformedOverview, 
  SolarEdgeQuotaInfo, 
  BuildingSiteBinding 
} from '../types';

// Constants
const SOLAREDGE_DIRECT_URL = 'https://monitoringapi.solaredge.com';
const SOLAREDGE_PROXY_URL = '/api/solaredge';
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

/**
 * Try the dev/prod proxy first (avoids browser CORS), fall back to a direct call.
 *
 * Two corrections over the previous version:
 *  1. A proxy response with an HTTP error status is RETURNED, not retried
 *     directly. The old code fell through on any non-2xx, so a single logical
 *     request cost two real SolarEdge calls and silently burned double quota.
 *  2. Production builds have no /api/solaredge route, so the SPA fallback
 *     answers 200 with index.html. The content-type check catches that and
 *     routes to the direct endpoint instead of failing on JSON.parse.
 */
async function fetchSolarEdgeApi(
  endpointWithQuery: string,
  options: SolarEdgeRequestOptions = {}
): Promise<Response> {
  const { signal } = options;
  const proxyUrl = `${SOLAREDGE_PROXY_URL}${endpointWithQuery}`;

  try {
    const res = await fetch(proxyUrl, {
      headers: { Accept: 'application/json' },
      signal,
    });

    const contentType = res.headers.get('content-type') || '';
    const proxyIsWired = contentType.includes('json');

    // The proxy reached SolarEdge — trust its answer, success or failure.
    if (proxyIsWired) return res;
  } catch (proxyErr) {
    if (signal?.aborted) throw proxyErr;
    console.warn('Proxy request failed, falling back to direct SolarEdge API call:', proxyErr);
  }

  const directUrl = `${SOLAREDGE_DIRECT_URL}${endpointWithQuery}`;
  return fetch(directUrl, {
    headers: { Accept: 'application/json' },
    signal,
  });
}

// LocalStorage Keys
const STORAGE_KEY_SITES_CACHE = 'solaredge_sites_cache_v4';
const STORAGE_KEY_OVERVIEWS_CACHE = 'solaredge_overviews_cache_v4';
const STORAGE_KEY_DAILY_CALLS = 'solaredge_daily_calls_v4';
const STORAGE_KEY_BINDINGS = 'mea_solar_building_bindings_v4';

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
    id: 2849103,
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
    id: 2849104,
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
    id: 2849105,
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
// Part 1: Data Fetching & API Logic (with Rate Limit 300 calls/day budget)
// -------------------------------------------------------------
export interface FetchSitesResult {
  sites: SolarEdgeRawSite[];
  overviews: Record<number, SolarEdgeTransformedOverview>;
  isUsingCache: boolean;
  quota: SolarEdgeQuotaInfo;
  error?: string;
}

export interface FetchAccountDataOptions extends SolarEdgeRequestOptions {
  forceRefresh?: boolean;
  useMock?: boolean;
  /** Skip the live call and serve cache when the daily budget is nearly spent. Default true. */
  respectQuotaReserve?: boolean;
}

/** Shape returned by the bulk endpoint /sites/{idList}/overview */
interface BulkOverviewResponse {
  sitesOverviews?: {
    count?: number;
    siteEnergyList?: Array<{
      siteId: number;
      siteOverview: SolarEdgeOverviewResponse['overview'];
    }>;
  };
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

/**
 * Fetch overviews for every site in ONE request.
 *
 * Endpoint: /sites/{siteId1,siteId2,...}/overview?api_key={API_KEY}
 *
 * This is the difference between the 5-minute poll fitting inside the daily
 * quota and blowing straight through it:
 *   per-site loop -> 5 calls x 12 polls/hour x 12 hours = 720 calls/day  (over the 300 limit)
 *   bulk endpoint -> 1 call  x 12 polls/hour x 12 hours = 144 calls/day  (comfortably inside)
 *
 * Falls back to the per-site loop if an account or firmware does not expose
 * the bulk route, so behaviour never regresses.
 */
async function fetchOverviewsBulk(
  apiKey: string,
  sites: SolarEdgeRawSite[],
  options: SolarEdgeRequestOptions = {}
): Promise<Record<number, SolarEdgeTransformedOverview> | null> {
  if (sites.length === 0) return null;

  const idList = sites.map((s) => s.id).join(',');
  const query = `/sites/${idList}/overview?api_key=${encodeURIComponent(apiKey.trim())}`;

  incrementDailyCallCount(1);
  const res = await fetchSolarEdgeApi(query, options);
  if (!res.ok) {
    console.warn(`Bulk overview endpoint unavailable (HTTP ${res.status}); using per-site calls.`);
    return null;
  }

  const data: BulkOverviewResponse = await res.json();
  const list = data.sitesOverviews?.siteEnergyList;
  if (!Array.isArray(list) || list.length === 0) return null;

  const byId = new Map(sites.map((s) => [s.id, s]));
  const record: Record<number, SolarEdgeTransformedOverview> = {};

  list.forEach((entry) => {
    const site = byId.get(entry.siteId);
    if (!site || !entry.siteOverview) return;
    record[entry.siteId] = transformSolarEdgeOverview(
      site.id,
      site.name,
      site.peakPower,
      site.status,
      entry.siteOverview,
      false
    );
  });

  // A site the bulk call omitted is simply absent. It previously received a
  // simulated overview "so it would not vanish", which meant a site SolarEdge
  // had no data for still showed a plausible number. Absent -> "no data".
  const missing = sites.filter((s) => !record[s.id]);
  if (missing.length > 0) {
    console.warn(
      `SolarEdge returned no overview for ${missing.length} site(s): ` +
        missing.map((s) => s.id).join(', ')
    );
  }

  return record;
}

/** Legacy path: one request per site, in parallel. Costs N calls. */
async function fetchOverviewsPerSite(
  apiKey: string,
  sites: SolarEdgeRawSite[],
  options: SolarEdgeRequestOptions = {}
): Promise<Record<number, SolarEdgeTransformedOverview>> {
  incrementDailyCallCount(sites.length);

  // A failed site yields null, not a simulated stand-in, so it surfaces as
  // "no data" instead of a convincing fabrication.
  const results = await Promise.all(
    sites.map(async (site): Promise<SolarEdgeTransformedOverview | null> => {
      try {
        const query = `/site/${site.id}/overview?api_key=${encodeURIComponent(apiKey.trim())}`;
        const res = await fetchSolarEdgeApi(query, options);
        if (!res.ok) {
          console.error(`Failed to fetch overview for site ${site.id}: HTTP ${res.status}`);
          return null;
        }
        const data: SolarEdgeOverviewResponse = await res.json();
        return transformSolarEdgeOverview(
          site.id,
          site.name,
          site.peakPower,
          site.status,
          data.overview,
          false
        );
      } catch (err) {
        if (options.signal?.aborted) throw err;
        console.error(`Error fetching overview for site ${site.id}:`, err);
        return null;
      }
    })
  );

  const record: Record<number, SolarEdgeTransformedOverview> = {};
  results.forEach((item) => {
    if (item) record[item.siteId] = item;
  });
  return record;
}

/**
 * Fetch all sites under the account and their overviews, with SWR caching,
 * quota protection and cancellation support.
 *
 * Call cost per live refresh:
 *   - first refresh of a session: 2 calls (/sites/list + bulk overview)
 *   - every later refresh:        1 call  (site list is reused from cache)
 */
export async function fetchSolarEdgeAccountData(
  apiKey: string,
  options: FetchAccountDataOptions = {}
): Promise<FetchSitesResult> {
  const {
    forceRefresh = false,
    useMock = false,
    respectQuotaReserve = true,
    signal,
  } = options;

  // 1a. Mock mode - simulated figures are the point here.
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
    };
  }

  // 1b. Live mode with no API key yet.
  //
  // The old condition was `useMock || !apiKey.trim()`, so switching to Live
  // before entering a key silently served the full mock dataset - the dashboard
  // claimed "SolarEdge Live API" while showing invented numbers. Live mode with
  // no credentials now returns nothing, and every tile reads "no data".
  if (!apiKey.trim()) {
    return {
      sites: [],
      overviews: {},
      isUsingCache: false,
      quota: getDailyQuotaInfo(),
      error: 'ยังไม่ได้กรอก SolarEdge API Key',
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
        error: 'โควตา SolarEdge API ใกล้หมด กำลังแสดงข้อมูลจากแคช',
      };
    }
  }

  try {
    // Step 1: site list. Reused from cache after the first successful fetch,
    // because the set of sites does not change during an event.
    let sites: SolarEdgeRawSite[];
    if (cachedSites && cachedSites.length > 0 && !forceRefresh) {
      sites = cachedSites;
    } else {
      const sitesQuery = `/sites/list?size=5&api_key=${encodeURIComponent(apiKey.trim())}`;
      incrementDailyCallCount(1);
      const sitesRes = await fetchSolarEdgeApi(sitesQuery, { signal });

      if (!sitesRes.ok) {
        throw new Error(
          `SolarEdge Sites List API error (HTTP ${sitesRes.status}): ${sitesRes.statusText}`
        );
      }

      const sitesData: SolarEdgeSitesListResponse = await sitesRes.json();
      sites = sitesData.sites?.site || [];
    }

    if (sites.length === 0) {
      throw new Error('ไม่พบไซต์ SolarEdge ในบัญชี API Key นี้');
    }

    // Step 2: overviews — one bulk call, per-site loop only as a fallback.
    let overviewsRecord = await fetchOverviewsBulk(apiKey, sites, { signal });
    if (!overviewsRecord) {
      overviewsRecord = await fetchOverviewsPerSite(apiKey, sites, { signal });
    }

    // Step 3: persist the SWR cache
    writeCache(sites, overviewsRecord);

    return {
      sites,
      overviews: overviewsRecord,
      isUsingCache: false,
      quota: getDailyQuotaInfo(),
    };
  } catch (error) {
    // A cancelled poll is normal (unmount / config change) — surface it so the
    // caller can drop the result instead of treating it as a data failure.
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }

    const errorMsg =
      error instanceof Error ? error.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ SolarEdge API';
    console.error('SolarEdge Live Fetch failed:', errorMsg);

    // Prefer the last good data over nothing: on a live dashboard a
    // five-minute-old real reading is still a real reading.
    if (cachedSites && cachedOverviews) {
      return {
        sites: cachedSites,
        overviews: cachedOverviews.data,
        isUsingCache: true,
        quota: getDailyQuotaInfo(),
        error: errorMsg,
      };
    }

    // NO MOCK FALLBACK IN LIVE MODE.
    //
    // This used to return MOCK_SOLAREDGE_SITES with simulated overviews, so a
    // failed connection produced a dashboard full of confident, entirely
    // invented figures - indistinguishable from real ones on a 72" screen.
    // Live mode now reports emptiness honestly and the UI renders "no data".
    // Simulated numbers are only ever produced when mock mode is explicitly on.
    return {
      sites: [],
      overviews: {},
      isUsingCache: false,
      quota: getDailyQuotaInfo(),
      error: errorMsg,
    };
  }
}
 
// -------------------------------------------------------------
// Part 3: Building ↔ Site Mapping Persistence
// -------------------------------------------------------------
export function loadBuildingSiteBindings(): Record<number, BuildingSiteBinding> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BINDINGS);
    if (!raw) {
      // Default sample bindings for 5 MEA Solar Roof Regional Sites
      const defaultBindings: Record<number, BuildingSiteBinding> = {
        1: {
          buildingId: 1,
          siteId: 2849101,
          siteName: 'MEA Solar Roof - สุราษฎร์ธานี',
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: new Date().toISOString(),
        },
        2: {
          buildingId: 2,
          siteId: 2849102,
          siteName: 'MEA Solar Roof - ภูเก็ต',
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: new Date().toISOString(),
        },
        3: {
          buildingId: 3,
          siteId: 2849103,
          siteName: 'MEA Solar Roof - ตรัง',
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: new Date().toISOString(),
        },
        4: {
          buildingId: 4,
          siteId: 2849104,
          siteName: 'MEA Solar Roof - หาดใหญ่',
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: new Date().toISOString(),
        },
        5: {
          buildingId: 5,
          siteId: 2849105,
          siteName: 'MEA Solar Roof - ปัตตานี',
          primaryMetric: 'currentPower',
          isBound: true,
          boundAt: new Date().toISOString(),
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
