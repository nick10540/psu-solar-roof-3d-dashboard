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

import {
  intervalsForSite,
  OVERVIEW_CACHE_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  ResolvedConfig,
  SiteDescriptor,
} from './config.js';


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
  /**
   * Cumulative CO2 avoided in KILOGRAMS, as SolarEdge itself reports it.
   *
   * null when the endpoint could not be read — never a locally derived
   * stand-in, so a failure cannot put an invented figure on screen under a
   * "Live API" badge.
   */
  co2Kg: number | null;
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
  bumpMonthCounter(n);
}

export function upstreamCallsToday(): number {
  return callCounter.day === todayKey() ? callCounter.count : 0;
}

// ---------------------------------------------------------------------------
// Plan-limit enforcement
//
// Two ceilings, enforced separately because they fail differently.
//
// Per MINUTE (10): a burst that crosses it returns 429 for whichever sites
// happen to sit last in the list, which reads on a 72" screen as "that campus
// is broken" rather than "we asked too fast". A cold start over four sites
// needs 16 requests, so the limiter has to WAIT — fetching serially, which
// this module already did, is not on its own enough.
//
// Per MONTH (2000): crossing it would fail every request for the rest of the
// month. Better to stop fetching, keep serving the last good payload, and say
// which of the two limits we are sitting against.
//
// Both counters live in module memory, matching the existing daily counter: a
// restart forgets them and on Cloudflare each isolate counts its own. Enough
// to protect the budget, not an accounting record.
// ---------------------------------------------------------------------------

let monthCounter = { month: '', count: 0 };

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function bumpMonthCounter(n: number): void {
  const month = monthKey();
  if (monthCounter.month !== month) monthCounter = { month, count: 0 };
  monthCounter.count += n;
}

export function upstreamCallsThisMonth(): number {
  return monthCounter.month === monthKey() ? monthCounter.count : 0;
}

/** Times of recent upstream calls, oldest first, trimmed to the window. */
const recentCallTimes: number[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Block until one more request fits inside the per-minute ceiling.
 *
 * Waits rather than throws: a cold start legitimately needs more requests
 * than one minute allows, and a 5-minute poll has the time to spend.
 */
async function reserveUpstreamSlot(maxPerMin: number): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (recentCallTimes.length > 0 && now - recentCallTimes[0] >= RATE_LIMIT_WINDOW_MS) {
      recentCallTimes.shift();
    }
    if (recentCallTimes.length < maxPerMin) {
      recentCallTimes.push(now);
      return;
    }
    // +250ms so a clock edge cannot let the call through a tick early.
    await sleep(RATE_LIMIT_WINDOW_MS - (now - recentCallTimes[0]) + 250);
  }
}

/** Forget the window and the month tally. Tests and manual resets only. */
export function resetCallLimiter(): void {
  recentCallTimes.length = 0;
  monthCounter = { month: '', count: 0 };
}

// ---------------------------------------------------------------------------
// Server-side response cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  payload: OverviewPayload;
  storedAt: number;
}

/**
 * Last-good payload and in-flight promise, keyed by the requested site set.
 *
 * Keyed rather than a single slot because the browser asks for whichever IDs
 * the operator has bound: two different requests sharing one slot would serve
 * each other's payload, and a pin would show another campus's numbers.
 *
 * Since the per-endpoint TTLs took over cadence control, this map is no longer
 * what decides whether a request costs an upstream call. It exists to collapse
 * simultaneous duplicates and to keep something on screen through an outage.
 */
const overviewCaches = new Map<string, CacheEntry>();
const overviewInflights = new Map<string, Promise<OverviewPayload>>();

function siteSetKey(cfg: ResolvedConfig): string {
  return cfg.sites
    .map((s) => s.siteId)
    .slice()
    .sort((a, b) => a - b)
    .join(',');
}

export function clearOverviewCache(): void {
  overviewCaches.clear();
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

  if (upstreamCallsThisMonth() >= cfg.monthlyCallBudget) {
    throw new UpstreamError(
      `งบเรียก API ประจำเดือนหมดแล้ว (${cfg.monthlyCallBudget} ครั้ง) — ` +
        `กำลังแสดงข้อมูลล่าสุดที่แคชไว้`,
      429
    );
  }

  await reserveUpstreamSlot(cfg.maxCallsPerMin);

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
  /** SolarEdge's cumulative CO2 in kg, or null if that call failed. */
  co2Kg: number | null;
}

/**
 * Month / year / lifetime + CO2, on their own cadence.
 *
 * These move slowly — a month total barely changes between two ticks — while
 * the API charges per minute, so they are the pair the operator's "energy
 * totals" interval controls. Keeping them off the live path is what lets the
 * live pair run at 30 s without tripling the upstream cost.
 */
const coldTotalsCache = new Map<number, { totals: ColdTotals; storedAt: number }>();

export function clearColdTotalsCache(): void {
  coldTotalsCache.clear();
}

/**
 * Environmental benefits, straight from SolarEdge.
 *
 * GET /sites/{id}/environmental-benefits -> { co2Emissions, evMiles, unit }.
 *
 * `co2Emissions` is CUMULATIVE, not today-only — the exception to the v2
 * rule documented above. Verified against the portal's own Environmental
 * Benefits panel for site 4956359: it read 601.653 kg while this endpoint
 * returned 598.73 shortly before. Reading it as a daily figure would
 * understate the tile by orders of magnitude.
 *
 * Only co2Emissions is taken. The response also carries `evMiles` (which
 * holds KILOMETRES when unit is METRIC, despite the name) and no tree
 * count at all — the portal derives trees from CO2 client-side.
 *
 * Returns null rather than throwing: losing this tile must never cost the
 * site its energy reading.
 */
async function loadEnvironmentalCo2Kg(
  cfg: ResolvedConfig,
  siteId: number
): Promise<number | null> {
  try {
    const raw = await getJson<unknown>(
      cfg,
      siteId,
      `/sites/${siteId}/environmental-benefits`
    );
    const body = (raw ?? {}) as { co2Emissions?: unknown; unit?: unknown };
    const value = num(body.co2Emissions);
    if (value <= 0) return null;
    // METRIC reports kg. Anything else is pounds.
    return body.unit === 'METRIC' ? value : value * 0.45359237;
  } catch {
    return null;
  }
}

/**
 * @param ttlMs How long a cached set stays good — the site's `energySec`.
 *
 * Deliberately NOT bypassable by `forceRefresh`. A page reload asks for fresh
 * numbers, and these two calls would add 2 per site to that burst — enough to
 * cross the per-minute ceiling on a four-site board and stall the reload for
 * a minute. A lifetime total that is up to one interval old is invisible;
 * a blank board for 60 s is not.
 */
async function loadColdTotals(
  cfg: ResolvedConfig,
  siteId: number,
  installationDate: string,
  ttlMs: number
): Promise<ColdTotals> {
  const hit = coldTotalsCache.get(siteId);
  if (hit && Date.now() - hit.storedAt < ttlMs) return hit.totals;

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

  // Folded in here rather than fetched per refresh. CO2 accumulates at exactly
  // the rate lifetime energy does (SolarEdge derives it from that same figure
  // at 0.392 kg/kWh), so it belongs on this cache, not on the live path.
  //
  // Fetching it every refresh took the steady-state cost for four sites from
  // 8 upstream calls to 12, which crossed the per-minute ceiling of the day
  // (10), stalled EVERY poll by ~60s and left the dashboard blank waiting for
  // it. The ceiling is 50 now and would absorb that, but the reason to keep
  // CO2 here is the one that has not changed: it moves at exactly the rate
  // lifetime energy does, so refetching it on the live path buys nothing.
  const co2Kg = await loadEnvironmentalCo2Kg(cfg, siteId);

  const totals: ColdTotals = {
    monthlyWh,
    yearlyWh,
    lifetimeWh: sumNonNull(points),
    co2Kg,
  };
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

// ---------------------------------------------------------------------------
// Per-endpoint caches — where the configurable cadence actually lands
//
// One entry per site per endpoint group, each expiring on the interval the
// operator set for THAT site. The browser ticks at the fastest configured
// interval and asks for every site every time; these three checks decide
// which of them costs an upstream call.
//
//   powerCache + energyTodayCache  <- powerSec   ("what is happening now")
//   coldTotalsCache                <- energySec  ("what has accumulated")
//
// A stale entry is KEPT, never dropped, when a refetch fails. At a 30-second
// cadence a lost request is routine — a 429, a timeout, a limiter stall — and
// blanking a campus on a 72" screen over one of them is far worse than showing
// a reading one tick old; the failure still travels in `errors` either way.
// ---------------------------------------------------------------------------

interface PowerCacheEntry {
  latest: { value: number; timestamp: string } | null;
  /** Reported samples only, already in the wire shape. */
  samples: PowerSample[];
  storedAt: number;
}

const powerCache = new Map<number, PowerCacheEntry>();
const energyTodayCache = new Map<number, { dailyWh: number; storedAt: number }>();

/** Forget the live series. Tests and manual resets only. */
export function clearSeriesCaches(): void {
  powerCache.clear();
  energyTodayCache.clear();
}

/**
 * Fetch one site, honouring its configured cadence.
 *
 * Every failure is reported against this site and never thrown: หาดใหญ่ hitting
 * a rate limit must not blank out ตรัง, which is what a thrown error would do
 * to the loop that calls this.
 *
 * Cost per round: 0 when nothing is due, 2 when the live pair is (power +
 * today's energy), 2 more when the totals are. Site metadata is one call a
 * day and `forceRefresh` deliberately does not touch it — names do not change.
 */
async function fetchOneSite(
  cfg: ResolvedConfig,
  desc: SiteDescriptor,
  forceRefresh: boolean
): Promise<{
  site: WireSite;
  overview: WireOverview | null;
  power: PowerSample[];
  error?: SiteFetchError;
}> {
  const siteId = desc.siteId;
  const { powerSec, energySec } = intervalsForSite(cfg, siteId);
  const liveTtlMs = powerSec * 1000;
  const totalsTtlMs = energySec * 1000;
  const now = Date.now();

  const site = normaliseSite(desc, await loadSiteMeta(cfg, desc));

  // First failure wins: it is the one closest to the cause, and a 429 on
  // /power followed by a 429 on /energy is one story, not two.
  let failure: SiteFetchError | undefined;
  const note = (err: unknown): void => {
    if (failure) return;
    failure = {
      siteId,
      message: err instanceof Error ? err.message : String(err),
      status: err instanceof UpstreamError ? err.status : 502,
    };
  };

  // --- live pair: /power then today's /energy ------------------------------
  // Sequential, not Promise.all: the rate limit is per MINUTE, and firing
  // every request for every site at once is what tripped it during
  // development. Spreading them costs a little latency and buys headroom
  // that matters more.
  let power = powerCache.get(siteId);
  if (forceRefresh || !power || now - power.storedAt >= liveTtlMs) {
    try {
      const points = seriesPoints(await getJson<unknown>(cfg, siteId, `/sites/${siteId}/power`));
      power = {
        latest: latestNonNull(points),
        // Only reported samples. A null is "not measured yet", and carrying it
        // through would draw the curve down to zero at the end of the day.
        samples: points
          .filter((pt): pt is { timestamp: string; value: number } =>
            typeof pt.value === 'number' && Number.isFinite(pt.value)
          )
          .map((pt) => ({ t: pt.timestamp, w: pt.value })),
        storedAt: Date.now(),
      };
      powerCache.set(siteId, power);
    } catch (err) {
      note(err);
    }
  }

  let energy = energyTodayCache.get(siteId);
  if (forceRefresh || !energy || now - energy.storedAt >= liveTtlMs) {
    try {
      const raw = await getJson<unknown>(cfg, siteId, `/sites/${siteId}/energy`);
      energy = { dailyWh: sumNonNull(seriesPoints(raw)), storedAt: Date.now() };
      energyTodayCache.set(siteId, energy);
    } catch (err) {
      note(err);
    }
  }

  // --- accumulating totals: month / year / lifetime / CO2 ------------------
  let cold: ColdTotals | null = null;
  try {
    cold = await loadColdTotals(cfg, siteId, site.installationDate, totalsTtlMs);
  } catch (err) {
    note(err);
  }

  // An overview needs a value — fresh OR cached — for all three groups.
  //
  // Filling a missing group with 0 would put a fabricated zero on a 72" screen
  // under a "Live API" badge, and the two zeros are not the same thing: 0 kW at
  // 21:00 is a real reading from an inverter with no sun, while 0 kWh lifetime
  // is a failed request wearing its clothes. Only ever reached on a cold start
  // — once a group has succeeded once, its cache covers the next failure for a
  // full interval, which is the whole point of keeping stale entries.
  if (!power || !energy || !cold) {
    return {
      site,
      overview: null,
      power: [],
      error: failure ?? { siteId, message: 'SolarEdge ยังไม่มีข้อมูลการผลิตของไซต์นี้' },
    };
  }

  // A site that reported nothing at all is "no data", not "zero" — same
  // distinction, for a site SolarEdge answers about but has no production for.
  if (!power.latest && energy.dailyWh === 0 && cold.lifetimeWh === 0) {
    return {
      site,
      overview: null,
      power: [],
      error: failure ?? { siteId, message: 'SolarEdge ยังไม่มีข้อมูลการผลิตของไซต์นี้' },
    };
  }

  const overview: WireOverview = {
    lastUpdateTime: power.latest?.timestamp || site.lastUpdateTime || new Date().toISOString(),
    currentPower: { power: power.latest?.value ?? 0 },
    lastDayData: { energy: energy.dailyWh },
    lastMonthData: { energy: cold.monthlyWh },
    lastYearData: { energy: cold.yearlyWh },
    lifetimeData: { energy: cold.lifetimeWh },
    measuredBy: 'INVERTER',
    co2Kg: cold.co2Kg,
  };

  // The error rides along WITH the readings when a cached value covered the
  // gap, so the settings panel still names what failed while the board stays
  // lit rather than the two outcomes being mutually exclusive.
  return { site, overview, power: power.samples, error: failure };
}

export interface FetchOverviewOptions {
  /**
   * Bypass the live pair's TTL — a page load asking for numbers now.
   *
   * Does NOT touch the totals or the site metadata. The per-minute ceiling
   * would now absorb those 2 extra calls per site, but a reload is not a
   * reason to re-derive a lifetime total from a multi-year month series: it
   * has not moved, and paying for it lengthens the very reload this exists to
   * make fast.
   */
  forceRefresh?: boolean;
}

/**
 * Assemble every configured site.
 *
 * No longer TTL-gated as a whole — the per-endpoint caches above decide what
 * costs an upstream call, so re-assembling the payload on every request is
 * free when nothing is due, and each site can run on its own cadence. What
 * survives from the old single-slot design is the in-flight collapse (two
 * kiosk tabs asking in the same instant share one round) and the last-good
 * payload `lastGoodPayload` serves through an outage.
 *
 * A failed site yields an entry in `errors`. It keeps its overview only when
 * a previous round's reading is still cached; otherwise it has none, and the
 * dashboard renders "ไม่มีข้อมูล" rather than a fabricated stand-in.
 */
export async function fetchAllOverviews(
  cfg: ResolvedConfig,
  options: FetchOverviewOptions = {}
): Promise<OverviewPayload> {
  const { forceRefresh = false } = options;
  const key = siteSetKey(cfg);

  const inflight = overviewInflights.get(key);
  if (inflight) return inflight;

  const pending = (async (): Promise<OverviewPayload> => {
    const callsBefore = upstreamCallsToday();

    // One site at a time, for the per-minute reason spelled out in fetchOneSite.
    const results: Array<Awaited<ReturnType<typeof fetchOneSite>>> = [];
    for (const desc of cfg.sites) {
      results.push(await fetchOneSite(cfg, desc, forceRefresh));
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
      // "Nothing was due": every figure in this payload came out of a cache.
      fromCache: upstreamCallsToday() === callsBefore,
      upstreamCallsToday: upstreamCallsToday(),
    };

    // Only keep a round that produced at least one reading. Storing a total
    // outage would hand `lastGoodPayload` an empty board to serve.
    if (Object.keys(overviews).length > 0) {
      overviewCaches.set(key, { payload, storedAt: Date.now() });
    }

    return payload;
  })().finally(() => {
    overviewInflights.delete(key);
  });

  overviewInflights.set(key, pending);
  return pending;
}

/**
 * Last good payload, used to keep the screen alive through an upstream outage.
 *
 * Bounded by OVERVIEW_CACHE_TTL_MS so a board that has been unreachable for
 * longer than that reports the outage instead of quietly presenting yesterday's
 * production as current.
 */
export function lastGoodPayload(): OverviewPayload | null {
  // Newest cached set wins: with several site sets in play, the most recent
  // round is the closest thing to "what the screen last showed".
  let newest: CacheEntry | null = null;
  for (const entry of overviewCaches.values()) {
    if (Date.now() - entry.storedAt >= OVERVIEW_CACHE_TTL_MS) continue;
    if (!newest || entry.storedAt > newest.storedAt) newest = entry;
  }
  return newest ? { ...newest.payload, fromCache: true } : null;
}
