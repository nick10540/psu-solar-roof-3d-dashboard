/**
 * solaredge.ts — the SolarEdge v2 data client.
 *
 * The key never appears in a URL — it rides in `X-API-Key`. That is the point
 * of moving off `?api_key=`: query strings end up in proxy logs, browser
 * history and Referer headers.
 *
 * Response normalisation: the backend assembles the v1-shaped `overview` object
 * the dashboard already knows how to transform, from the v2 series endpoints.
 * That keeps the wire contract with the frontend stable across upstream
 * reshaping, and confines every v2 quirk to this one file.
 */

import { OVERVIEW_CACHE_TTL_MS, ResolvedConfig, SiteDescriptor } from './config.js';


// ---------------------------------------------------------------------------
// Wire shapes handed to the dashboard (mirrors src/types.ts)
// ---------------------------------------------------------------------------

export interface WireEnergyMetric {
  energy: number; // Watt-hours
  revenue?: number;
}

export interface WireOverview {
  lastUpdateTime: string;
  lifetimeData: WireEnergyMetric;
  lastYearData: WireEnergyMetric;
  lastMonthData: WireEnergyMetric;
  lastDayData: WireEnergyMetric;
  currentPower: { power: number }; // Watts
  measuredBy: string;
}

export interface WireSite {
  id: number;
  name: string;
  accountId: number;
  status: 'Active' | 'Pending' | 'Disabled';
  peakPower: number; // kWp
  lastUpdateTime: string;
  currency: string;
  installationDate: string;
  ptoDate: string | null;
  notes: string;
  type: string;
  location: { country: string; city: string; address: string; zip: string; timeZone: string };
  primaryModule: { manufacturerName: string; modelName: string; maximumPower: number };
}

export interface SiteFetchError {
  siteId: number;
  message: string;
  status?: number;
}

/** One point of today's power curve, in Watts. Nulls are dropped. */
export interface PowerSample {
  t: string;
  w: number;
}

export interface OverviewPayload {
  sites: WireSite[];
  overviews: Record<number, WireOverview>;
  /**
   * Today's quarter-hourly power curve per site.
   *
   * Passed through because the backend already fetches it to derive current
   * power — the detail page's chart costs nothing extra. Without it that chart
   * falls back to a simulated curve scaled by capacity, which on a live
   * dashboard is a fabricated shape sitting under real headline figures.
   */
  powerSeries: Record<number, PowerSample[]>;
  errors: SiteFetchError[];
  fetchedAt: number;
  fromCache: boolean;
  upstreamCallsToday: number;
}

// ---------------------------------------------------------------------------
// Upstream call accounting
// ---------------------------------------------------------------------------

let callCounter = { day: '', count: 0 };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function countUpstreamCall(n = 1): void {
  const day = todayKey();
  if (callCounter.day !== day) callCounter = { day, count: 0 };
  callCounter.count += n;
}

export function upstreamCallsToday(): number {
  return callCounter.day === todayKey() ? callCounter.count : 0;
}

// ---------------------------------------------------------------------------
// Server-side response cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  payload: OverviewPayload;
  storedAt: number;
}

let overviewCache: CacheEntry | null = null;
let overviewInflight: Promise<OverviewPayload> | null = null;

export function clearOverviewCache(): void {
  overviewCache = null;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

class UpstreamError extends Error {
  readonly status: number;
  /** Seconds the API asked us to wait, from a 429's retry-after header. */
  readonly retryAfterSec: number | null;

  constructor(message: string, status: number, retryAfterSec: number | null = null) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Translate the API's documented error classes into something a person can act
 * on. A bare "HTTP 403" sends whoever is debugging it looking at the network;
 * "this site was never authorized" sends them to the right button.
 */
function describeApiError(siteId: number, status: number, body: string): string {
  if (status === 401) {
    return `ไซต์ ${siteId}: API Key ไม่ถูกต้องหรือถูกเพิกถอน — ตรวจสอบ SOLAREDGE_API_KEY`;
  }
  if (status === 403) {
    return /tier/i.test(body)
      ? `ไซต์ ${siteId}: endpoint นี้ต้องใช้ package ระดับสูงกว่า (403)`
      : `ไซต์ ${siteId}: API Key ไม่ครอบคลุมไซต์นี้ — ต้องอยู่ใน fleet ของบัญชีที่ออก key`;
  }
  if (status === 429) {
    return /credit/i.test(body)
      ? `ไซต์ ${siteId}: ใช้เครดิตรายเดือนหมดแล้ว (รีเซ็ตรอบบิลถัดไป)`
      : `ไซต์ ${siteId}: เรียก API ถี่เกินกำหนด (rate limit)`;
  }
  return `ไซต์ ${siteId}: HTTP ${status}${body ? ` — ${body.slice(0, 160)}` : ''}`;
}

/**
 * GET a JSON path for one site with the Fleet API Key.
 *
 * No retry on 401: the key is either accepted or it is not, and a second
 * attempt would only spend rate limit — which the API charges per minute.
 */
async function getJson<T>(cfg: ResolvedConfig, siteId: number, path: string): Promise<T> {
  const url = `${cfg.apiBase}${path}`;

  let res: Response;
  try {
    countUpstreamCall();
    res = await fetch(url, {
      headers: { 'X-API-Key': cfg.apiKey, Accept: 'application/json' },
    });
  } catch (err) {
    throw new UpstreamError(err instanceof Error ? err.message : String(err), 502);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new UpstreamError(
      describeApiError(siteId, res.status, body),
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null
    );
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// ---------------------------------------------------------------------------
// v2 time-series
//
// The v2 API has no combined "overview" like v1 did. Everything the dashboard
// shows is assembled from two series endpoints:
//
//   GET /sites/{id}/power    unit W,  QUARTER_HOUR   -> current power
//   GET /sites/{id}/energy   unit WH, QUARTER_HOUR   -> energy in a period
//
// CRUCIAL: every endpoint defaults to TODAY, in site-local time. That includes
// /sites/{id}/overview, whose `production.total` therefore reports today's
// production — NOT lifetime. Reading it as lifetime is the single easiest way
// to put a wrong number on a 72" screen, which is why this file does not use
// that endpoint at all and derives every figure from explicit ranges instead.
//
// Verified against site 4956359 on 2026-08-29:
//   DAY buckets   26th=19,870  27th=243,854  28th=361,482  29th=173,630 Wh
//   MONTH bucket  Aug = 798,836 Wh   (exactly the sum of the days)
//   /overview     173,630 Wh         (= the 29th alone)
// ---------------------------------------------------------------------------

interface SeriesPoint {
  timestamp: string;
  value: number | null;
}

interface SeriesResponse {
  unit?: string;
  resolution?: string;
  values?: SeriesPoint[];
}

function seriesPoints(raw: unknown): SeriesPoint[] {
  const body = (raw && typeof raw === 'object' ? raw : {}) as SeriesResponse;
  return Array.isArray(body.values) ? body.values : [];
}

/**
 * Latest reading in a power series.
 *
 * Power is an instantaneous measure, so it is READ, never summed — adding up
 * quarter-hourly watt readings produces a large, entirely meaningless number.
 * Trailing nulls are normal: the series runs to "now" but the last few slots
 * have not been reported yet.
 */
function latestNonNull(points: SeriesPoint[]): { value: number; timestamp: string } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (typeof p?.value === 'number' && Number.isFinite(p.value)) {
      return { value: p.value, timestamp: p.timestamp };
    }
  }
  return null;
}

/** Total of an energy series. Nulls are "not reported", which is not zero. */
function sumNonNull(points: SeriesPoint[]): number {
  return points.reduce((acc, p) => acc + (typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : 0), 0);
}

/**
 * Monthly buckets since the site was switched on, used for month / year /
 * lifetime totals in ONE request.
 *
 * `from` deliberately reaches a little before the installation date: a site
 * commissioned mid-month still has a partial first month, and starting the
 * range after it would silently drop that production from the lifetime figure.
 */
function monthSeriesRange(installationDate: string): { from: string; to: string } {
  const installed = Date.parse(installationDate);
  const start = Number.isFinite(installed)
    ? new Date(installed - 32 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);

  return { from: start.toISOString(), to: new Date().toISOString() };
}

interface ColdTotals {
  monthlyWh: number;
  yearlyWh: number;
  lifetimeWh: number;
}

/**
 * Month / year / lifetime, cached far longer than the live figures.
 *
 * These move slowly — a month total barely changes between two five-minute
 * ticks — while the API charges per minute. Splitting them off means the
 * steady-state cost of a poll is two requests per site instead of three, which
 * is what keeps a three-site dashboard clear of the rate limit.
 */
const COLD_TOTALS_TTL_MS = 30 * 60 * 1000;
const coldTotalsCache = new Map<number, { totals: ColdTotals; storedAt: number }>();

export function clearColdTotalsCache(): void {
  coldTotalsCache.clear();
}

async function loadColdTotals(
  cfg: ResolvedConfig,
  siteId: number,
  installationDate: string
): Promise<ColdTotals> {
  const hit = coldTotalsCache.get(siteId);
  if (hit && Date.now() - hit.storedAt < COLD_TOTALS_TTL_MS) return hit.totals;

  const { from, to } = monthSeriesRange(installationDate);
  const raw = await getJson<unknown>(
    cfg,
    siteId,
    `/sites/${siteId}/energy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&resolution=MONTH`
  );

  const points = seriesPoints(raw);

  // Bucket timestamps come back in site-local time ("2026-08-01T00:00:00+07:00"),
  // so comparing the leading YYYY-MM keeps month and year boundaries aligned
  // with the site's own calendar rather than UTC's.
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisYear = String(now.getFullYear());

  let monthlyWh = 0;
  let yearlyWh = 0;
  for (const p of points) {
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) continue;
    if (p.timestamp.startsWith(thisMonth)) monthlyWh += p.value;
    if (p.timestamp.startsWith(thisYear)) yearlyWh += p.value;
  }

  const totals: ColdTotals = { monthlyWh, yearlyWh, lifetimeWh: sumNonNull(points) };
  coldTotalsCache.set(siteId, { totals, storedAt: Date.now() });
  return totals;
}


/**
 * Build a `WireSite` from `GET /v2/sites/{id}`.
 *
 * The v2 payload is flatter and renames several fields from v1 — `siteId` not
 * `id`, `activationStatus` not `status`, `location.timezone` not `timeZone`,
 * `note` not `notes` — and drops `currency`, `type` and `primaryModule`
 * entirely. Both spellings are accepted so a v1-shaped response (or a future
 * rename back) still maps, and anything genuinely missing falls back to the
 * static registry rather than rendering blank on a 72" screen.
 */
function normaliseSite(desc: SiteDescriptor, raw: unknown): WireSite {
  const root = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const body = (root.site && typeof root.site === 'object' ? root.site : root) as Record<string, unknown>;
  const location = (body.location && typeof body.location === 'object' ? body.location : {}) as Record<string, unknown>;

  const peak = num(body.peakPower ?? body.installedCapacity);

  // v2: "ACTIVE" | "PENDING" | "DISABLED" (upper case). v1: "Active" | …
  const rawStatus = String(body.activationStatus ?? body.status ?? '').toUpperCase();
  const status: WireSite['status'] =
    rawStatus === 'PENDING' ? 'Pending' : rawStatus === 'DISABLED' ? 'Disabled' : 'Active';

  return {
    id: desc.siteId,
    name: typeof body.name === 'string' && body.name.trim() ? body.name : desc.fallbackName,
    accountId: num(body.accountId),
    status,
    peakPower: peak > 0 ? peak : desc.fallbackPeakPowerKwp,
    lastUpdateTime: typeof body.lastUpdateTime === 'string' ? body.lastUpdateTime : '',
    currency: typeof body.currency === 'string' ? body.currency : 'THB',
    installationDate: typeof body.installationDate === 'string' ? body.installationDate : '',
    ptoDate: typeof body.ptoDate === 'string' ? body.ptoDate : null,
    notes: typeof body.note === 'string' ? body.note : typeof body.notes === 'string' ? body.notes : '',
    type: typeof body.type === 'string' ? body.type : 'Commercial Rooftop',
    location: {
      country: typeof location.country === 'string' ? location.country : 'Thailand',
      city: typeof location.city === 'string' ? location.city : desc.fallbackCity,
      address: typeof location.address === 'string' ? location.address : '',
      zip: typeof location.zip === 'string' ? location.zip : '',
      timeZone:
        typeof location.timezone === 'string'
          ? location.timezone
          : typeof location.timeZone === 'string'
            ? location.timeZone
            : 'Asia/Bangkok',
    },
    primaryModule: { manufacturerName: 'SolarEdge', modelName: '', maximumPower: 0 },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Site metadata cache.
 *
 * Names, capacities and addresses do not change during a ceremony — or a year.
 * Re-fetching them on every 4.5-minute tick DOUBLED the upstream call count for
 * data nobody was watching change. Cached for a day, and a failed lookup is
 * cached too so a 404 endpoint is not retried forever at full price.
 */
const SITE_META_TTL_MS = 24 * 60 * 60 * 1000;
const siteMetaCache = new Map<number, { meta: unknown; storedAt: number }>();

export function clearSiteMetaCache(): void {
  siteMetaCache.clear();
}

async function loadSiteMeta(cfg: ResolvedConfig, desc: SiteDescriptor): Promise<unknown> {
  const hit = siteMetaCache.get(desc.siteId);
  if (hit && Date.now() - hit.storedAt < SITE_META_TTL_MS) return hit.meta;

  try {
    const meta = await getJson<unknown>(cfg, desc.siteId, `/sites/${desc.siteId}`);
    siteMetaCache.set(desc.siteId, { meta, storedAt: Date.now() });
    return meta;
  } catch {
    // Metadata is a nice-to-have: the registry fallback covers it, and losing a
    // display name must never cost us the energy reading. Caching the failure
    // stops a 404 endpoint being retried at full price on every poll.
    siteMetaCache.set(desc.siteId, { meta: null, storedAt: Date.now() });
    return null;
  }
}

/**
 * Fetch one site.
 *
 * Every failure is reported against this site and never thrown: หาดใหญ่ hitting
 * a rate limit must not blank out ตรัง, which is what a thrown error would do
 * to the loop that calls this.
 *
 * Cost: 2 live requests (power + today's energy) plus 1 more only when the
 * 30-minute cold cache has expired.
 */
async function fetchOneSite(
  cfg: ResolvedConfig,
  desc: SiteDescriptor
): Promise<{
  site: WireSite;
  overview: WireOverview | null;
  power: PowerSample[];
  error?: SiteFetchError;
}> {
  const toError = (err: unknown): SiteFetchError => ({
    siteId: desc.siteId,
    message: err instanceof Error ? err.message : String(err),
    status: err instanceof UpstreamError ? err.status : 502,
  });

  let siteMeta: unknown = null;
  try {
    siteMeta = await loadSiteMeta(cfg, desc);
  } catch (err) {
    return { site: normaliseSite(desc, null), overview: null, power: [], error: toError(err) };
  }

  const site = normaliseSite(desc, siteMeta);

  try {
    // Sequential, not Promise.all: the rate limit is per MINUTE, and firing
    // every request for every site at once is what tripped it during
    // development. Spreading them costs a little latency on a 5-minute poll and
    // buys headroom that matters more.
    const powerRaw = await getJson<unknown>(cfg, desc.siteId, `/sites/${desc.siteId}/power`);
    const energyRaw = await getJson<unknown>(cfg, desc.siteId, `/sites/${desc.siteId}/energy`);
    const cold = await loadColdTotals(cfg, desc.siteId, site.installationDate);

    const powerPoints = seriesPoints(powerRaw);
    const latest = latestNonNull(powerPoints);
    const dailyWh = sumNonNull(seriesPoints(energyRaw));

    // Only reported samples. A null is "not measured yet", and carrying it
    // through would draw the curve down to zero at the end of the day.
    const power: PowerSample[] = powerPoints
      .filter((p): p is { timestamp: string; value: number } =>
        typeof p.value === 'number' && Number.isFinite(p.value)
      )
      .map((p) => ({ t: p.timestamp, w: p.value }));

    // A site that reported nothing at all is "no data", not "zero". Zero is a
    // real measurement — an inverter that is on and producing nothing — and on
    // a big screen the two must not look the same.
    if (!latest && dailyWh === 0 && cold.lifetimeWh === 0) {
      return {
        site,
        overview: null,
        power: [],
        error: { siteId: desc.siteId, message: 'SolarEdge ยังไม่มีข้อมูลการผลิตของไซต์นี้' },
      };
    }

    const overview: WireOverview = {
      lastUpdateTime: latest?.timestamp || site.lastUpdateTime || new Date().toISOString(),
      currentPower: { power: latest?.value ?? 0 },
      lastDayData: { energy: dailyWh },
      lastMonthData: { energy: cold.monthlyWh },
      lastYearData: { energy: cold.yearlyWh },
      lifetimeData: { energy: cold.lifetimeWh },
      measuredBy: 'INVERTER',
    };

    return { site, overview, power };
  } catch (err) {
    return { site, overview: null, power: [], error: toError(err) };
  }
}

export interface FetchOverviewOptions {
  forceRefresh?: boolean;
}

/**
 * Fetch every configured site, with a shared server-side cache.
 *
 * A failed site yields an entry in `errors` and NO overview — never a
 * fabricated stand-in. The dashboard already renders a site with no overview as
 * "ไม่มีข้อมูล", which is the honest outcome on a 72" screen.
 */
export async function fetchAllOverviews(
  cfg: ResolvedConfig,
  options: FetchOverviewOptions = {}
): Promise<OverviewPayload> {
  const { forceRefresh = false } = options;

  if (!forceRefresh && overviewCache && Date.now() - overviewCache.storedAt < OVERVIEW_CACHE_TTL_MS) {
    return { ...overviewCache.payload, fromCache: true };
  }

  // Collapse concurrent misses into one upstream round. Two kiosk tabs
  // refreshing together should cost one fetch, not two.
  if (overviewInflight) return overviewInflight;

  const pending = (async (): Promise<OverviewPayload> => {
    // One site at a time. Each site costs 2-3 upstream requests and the API's
    // rate limit is per MINUTE — fanning three sites out at once was enough to
    // trip it during development. A 5-minute poll has all the time it needs.
    const results: Array<Awaited<ReturnType<typeof fetchOneSite>>> = [];
    for (const desc of cfg.sites) {
      results.push(await fetchOneSite(cfg, desc));
    }

    const sites: WireSite[] = [];
    const overviews: Record<number, WireOverview> = {};
    const powerSeries: Record<number, PowerSample[]> = {};
    const errors: SiteFetchError[] = [];

    results.forEach(({ site, overview, power, error }) => {
      sites.push(site);
      if (overview) overviews[site.id] = overview;
      if (power.length) powerSeries[site.id] = power;
      if (error) errors.push(error);
    });

    const payload: OverviewPayload = {
      sites,
      overviews,
      powerSeries,
      errors,
      fetchedAt: Date.now(),
      fromCache: false,
      upstreamCallsToday: upstreamCallsToday(),
    };

    // Only cache a round that produced at least one reading. Caching a total
    // outage for 4.5 minutes would turn a transient blip into a visible gap.
    if (Object.keys(overviews).length > 0) {
      overviewCache = { payload, storedAt: Date.now() };
    }

    return payload;
  })().finally(() => {
    overviewInflight = null;
  });

  overviewInflight = pending;
  return pending;
}

/** Last good payload, used to keep the screen alive through an upstream outage. */
export function lastGoodPayload(): OverviewPayload | null {
  return overviewCache ? { ...overviewCache.payload, fromCache: true } : null;
}
