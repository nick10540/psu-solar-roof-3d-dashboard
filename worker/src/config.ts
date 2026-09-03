/**
 * config.ts — Runtime configuration for the SolarEdge backend.
 *
 * Everything that differs between local dev, the kiosk PC and a Cloudflare
 * deployment arrives through `WorkerEnv`, so the same handler code runs
 * unchanged on all three. Nothing in here is baked into the browser bundle:
 * the API key never leaves this process.
 */

export interface WorkerEnv {
  /**
   * Fleet API Key ("My Fleet Access" in the SolarEdge Developer Platform),
   * sent as `X-API-Key`. Covers every site in the account's fleet.
   *
   * This is the only supported credential. SolarEdge's other path — the
   * OAuth consent flow at connect.solaredge.com — refuses outright when the
   * signing-in user owns more than one site:
   *
   *   "user … is associated to multiple SolarEdge sites.
   *    Multi-site access is not supported yet by this service."
   *
   * which is exactly this deployment. `client_credentials` is not supported by
   * the token endpoint either, so there is no unattended OAuth path at all.
   */
  SOLAREDGE_API_KEY: string;

  /** Base URL for the data API. */
  SOLAREDGE_API_BASE?: string;

  /** Comma-separated allow-list of site IDs this backend may read. */
  SOLAREDGE_SITE_IDS?: string;

  /**
   * Upstream requests allowed per rolling minute. Default 50, the upgraded
   * package's ceiling. Lower it to leave room for another consumer of the key;
   * raising it past what the account allows only moves the refusal upstream.
   */
  SOLAREDGE_MAX_CALLS_PER_MIN?: string;

  /**
   * Upstream requests allowed per calendar month. Default 100000 — a spend
   * ceiling this backend holds itself to, not a figure read off the plan. Once
   * spent, the backend serves cache instead of fetching.
   */
  SOLAREDGE_MONTHLY_CALL_BUDGET?: string;

  /**
   * Default refresh cadence, in seconds, when the browser sends none.
   *
   * The dashboard normally sends its own per-site values, so these only cover
   * a bare `GET /api/solaredge/overview` — a curl check, a health probe, or a
   * kiosk whose localStorage has been wiped. Floored at MIN_REFRESH_INTERVAL_SEC.
   */
  SOLAREDGE_POWER_INTERVAL_SEC?: string;
  SOLAREDGE_ENERGY_INTERVAL_SEC?: string;

  /** Comma-separated CORS origins. Empty/absent => same-origin only. */
  ALLOWED_ORIGINS?: string;

  /** Node adapter only. */
  PORT?: string;
}

export const DEFAULT_API_BASE = 'https://monitoringapi.solaredge.com/v2';

/**
 * Plan limits, and why they are enforced here rather than hoped for.
 *
 * Two ceilings that fail differently.
 *
 * Per MINUTE (50 since the account was upgraded, up from the entry package's
 * 10): a burst that crosses it returns 429 for whichever sites happen to sit
 * last in the list, which reads on a 72" screen as "that campus is broken"
 * rather than "we asked too fast". Sequential fetching alone does not fix
 * that; the burst has to actually wait, which is what `reserveUpstreamSlot`
 * does. At 50 the 30-second floor finally fits: four sites at 30 s on both
 * knobs want 32/min, and even six sites stay under.
 *
 * Per MONTH: raised from the entry package's 2000 to 100000 at the operator's
 * request, so the configurable 30-second refresh intervals below have room to
 * run. Read both numbers as SPEND CEILINGS this backend holds itself to, not
 * as claims about the account — if the real allowance is lower, SolarEdge
 * answers 429 long before either guard fires.
 *
 * The MONTHLY figure is the binding constraint again: four sites at the 30 s
 * floor spend ~46k/day, so 100000 lasts about two days. The settings panel
 * puts that arithmetic on screen rather than leaving it to be discovered.
 */
export const DEFAULT_MAX_CALLS_PER_MIN = 50;
export const DEFAULT_MONTHLY_CALL_BUDGET = 100000;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Refresh cadence
//
// The operator sets two intervals per site, in seconds. The BACKEND, not the
// browser, decides when an upstream call actually happens: the dashboard ticks
// at the fastest configured interval and asks for every site every time, and
// the TTLs below decide which endpoints are due. That is what stops a second
// tab, an F5, or a colleague's laptop from multiplying the spend.
//
// The split is "what is happening now" vs. "what has accumulated", because
// those are the two pairs that cost 2 upstream calls each — and grouping them
// this way makes the DEFAULT cadence byte-for-byte what the board did before
// the knob existed (power+today every 5 min, totals every 30 min):
//
//   powerSec  -> /sites/{id}/power        + /sites/{id}/energy   (today)
//   energySec -> /sites/{id}/energy?MONTH + /sites/{id}/environmental-benefits
// ---------------------------------------------------------------------------

/**
 * Floor for both intervals.
 *
 * Enforced here as well as in the settings UI: a hand-edited localStorage
 * entry or a crafted query string must not be able to ask this backend to
 * hammer SolarEdge every second.
 */
export const MIN_REFRESH_INTERVAL_SEC = 30;

/** A day. Anything slower is indistinguishable from "off" on a kiosk. */
export const MAX_REFRESH_INTERVAL_SEC = 86400;

/** Cadence when the client sends none — i.e. the pre-knob behaviour. */
export const DEFAULT_POWER_INTERVAL_SEC = 300;
export const DEFAULT_ENERGY_INTERVAL_SEC = 1800;

export interface RefreshIntervals {
  /** Seconds between /power and today's /energy for one site. */
  powerSec: number;
  /** Seconds between the month-series and environmental-benefits calls. */
  energySec: number;
}

export const DEFAULT_REFRESH_INTERVALS: RefreshIntervals = {
  powerSec: DEFAULT_POWER_INTERVAL_SEC,
  energySec: DEFAULT_ENERGY_INTERVAL_SEC,
};

/** Clamp one interval into [MIN, MAX], falling back when unparseable. */
export function clampIntervalSec(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_REFRESH_INTERVAL_SEC, Math.max(MIN_REFRESH_INTERVAL_SEC, Math.floor(n)));
}

/**
 * Last-good-payload retention.
 *
 * No longer a cadence control — the per-endpoint TTLs above are. This is only
 * how long an assembled payload stays worth serving through an outage, and how
 * long a duplicate request inside the same instant is collapsed into one.
 */
export const OVERVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface SiteDescriptor {
  siteId: number;
  /** Thai display name, used when the API's own site metadata is unavailable. */
  fallbackName: string;
  /** Installed capacity (kWp), used for the same fallback. */
  fallbackPeakPowerKwp: number;
  fallbackCity: string;
}

/**
 * The four live sites.
 *
 * ภูเก็ต is intentionally absent: no site ID has been issued for it yet. It
 * stays unbound on the dashboard and renders as "ไม่มีข้อมูล" rather than
 * borrowing a neighbour's numbers. Add it here when its ID exists and it
 * lights up with no other change.
 *
 * The fallback capacities are only used if the API cannot be reached — the
 * real values (1500 / 999.36 / 1522.08 / 650.88 kWp) come from /sites/{id}.
 */
export const SITE_REGISTRY: SiteDescriptor[] = [
  { siteId: 4956359, fallbackName: 'MEA Solar Roof - หาดใหญ่', fallbackPeakPowerKwp: 1500.0, fallbackCity: 'หาดใหญ่' },
  { siteId: 4821237, fallbackName: 'MEA Solar Roof - ตรัง', fallbackPeakPowerKwp: 999.36, fallbackCity: 'ตรัง' },
  { siteId: 4947126, fallbackName: 'MEA Solar Roof - ปัตตานี', fallbackPeakPowerKwp: 1522.08, fallbackCity: 'ปัตตานี' },
  { siteId: 4817295, fallbackName: 'MEA Solar Roof - สุราษฎร์ธานี', fallbackPeakPowerKwp: 650.88, fallbackCity: 'สุราษฎร์ธานี' },
];

export interface ResolvedConfig {
  apiKey: string;
  apiBase: string;
  sites: SiteDescriptor[];
  allowedOrigins: string[];
  maxCallsPerMin: number;
  monthlyCallBudget: number;
  /** Cadence for any site with no explicit override. */
  refreshIntervals: RefreshIntervals;
  /**
   * Per-site cadence, keyed by site ID.
   *
   * Sparse on purpose: a site the operator never touched is not listed, so
   * moving the global default moves it too instead of leaving a stale copy
   * behind. `intervalsForSite` does the lookup.
   */
  siteIntervals: Map<number, RefreshIntervals>;
}

/** The cadence in force for one site: its override, else the global default. */
export function intervalsForSite(cfg: ResolvedConfig, siteId: number): RefreshIntervals {
  return cfg.siteIntervals.get(siteId) ?? cfg.refreshIntervals;
}

export class ConfigError extends Error {}

/** A positive integer from env, or the default when absent or malformed. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number((raw || '').trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Validate env once per request rather than at module load.
 *
 * A Cloudflare Worker receives its env per-invocation, and a missing secret
 * must surface as a clean 500 with an actionable message — not a module that
 * refuses to evaluate and takes the whole isolate down with it.
 */
export function resolveConfig(env: WorkerEnv): ResolvedConfig {
  const apiKey = (env.SOLAREDGE_API_KEY || '').trim();

  if (!apiKey) {
    throw new ConfigError(
      'SOLAREDGE_API_KEY is not set. Generate a Fleet API Key in the SolarEdge ' +
        'Developer Platform ("My Fleet Access"), then copy ' +
        'worker/.dev.vars.example to worker/.dev.vars and paste it in.'
    );
  }

  // An explicit allow-list narrows the registry; anything not in the registry
  // is ignored, so a typo in env cannot make the backend fetch a stranger's site.
  const allowedIds = parseCsv(env.SOLAREDGE_SITE_IDS).map(Number).filter((n) => Number.isFinite(n));
  const sites =
    allowedIds.length > 0
      ? SITE_REGISTRY.filter((s) => allowedIds.includes(s.siteId))
      : SITE_REGISTRY;

  if (sites.length === 0) {
    throw new ConfigError(
      `SOLAREDGE_SITE_IDS matched no known site. Known IDs: ${SITE_REGISTRY.map((s) => s.siteId).join(', ')}`
    );
  }

  return {
    apiKey,
    apiBase: (env.SOLAREDGE_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, ''),
    sites,
    allowedOrigins: parseCsv(env.ALLOWED_ORIGINS),
    maxCallsPerMin: positiveInt(env.SOLAREDGE_MAX_CALLS_PER_MIN, DEFAULT_MAX_CALLS_PER_MIN),
    monthlyCallBudget: positiveInt(
      env.SOLAREDGE_MONTHLY_CALL_BUDGET,
      DEFAULT_MONTHLY_CALL_BUDGET
    ),
    refreshIntervals: {
      powerSec: clampIntervalSec(env.SOLAREDGE_POWER_INTERVAL_SEC, DEFAULT_POWER_INTERVAL_SEC),
      energySec: clampIntervalSec(env.SOLAREDGE_ENERGY_INTERVAL_SEC, DEFAULT_ENERGY_INTERVAL_SEC),
    },
    siteIntervals: new Map(),
  };
}

/**
 * Overlay the cadence the browser asked for.
 *
 * Every value goes through `clampIntervalSec`, so no query string can get
 * below the 30-second floor however it is spelled. An absent or unparseable
 * field leaves the env-resolved default in place rather than snapping to the
 * floor — an operator who set only the power interval keeps the energy default.
 */
export function withRefreshIntervals(
  cfg: ResolvedConfig,
  requested: {
    powerSec?: unknown;
    energySec?: unknown;
    perSite?: Array<{ siteId: number; powerSec?: unknown; energySec?: unknown }>;
  }
): ResolvedConfig {
  const refreshIntervals: RefreshIntervals = {
    powerSec: clampIntervalSec(requested.powerSec, cfg.refreshIntervals.powerSec),
    energySec: clampIntervalSec(requested.energySec, cfg.refreshIntervals.energySec),
  };

  const siteIntervals = new Map<number, RefreshIntervals>();
  for (const entry of requested.perSite ?? []) {
    if (!Number.isInteger(entry.siteId) || entry.siteId <= 0) continue;
    siteIntervals.set(entry.siteId, {
      powerSec: clampIntervalSec(entry.powerSec, refreshIntervals.powerSec),
      energySec: clampIntervalSec(entry.energySec, refreshIntervals.energySec),
    });
  }

  return { ...cfg, refreshIntervals, siteIntervals };
}

/**
 * Narrow (or extend) a resolved config to an explicit list of site IDs.
 *
 * The dashboard now owns the building -> site-ID mapping: an operator types IDs
 * into the binding modal, and the browser asks for exactly those. The env
 * allow-list stays as the DEFAULT set for a cold open, not as a hard ceiling —
 * otherwise a freshly typed ID could never be fetched.
 *
 * The security boundary is the credential, not this list. A Fleet API Key only
 * covers its own account, so a requested ID outside it comes back 403 from
 * SolarEdge rather than leaking anything.
 *
 * An ID with no registry entry gets a descriptor with an empty fallback name
 * and zero fallback capacity: those are only used when the API cannot be
 * reached, and inventing a name for a site we know nothing about would be worse
 * than showing none.
 */
export function withRequestedSites(cfg: ResolvedConfig, requested: number[]): ResolvedConfig {
  const ids: number[] = [];
  for (const id of requested) {
    if (!Number.isInteger(id) || id <= 0 || ids.includes(id)) continue;
    ids.push(id);
    // A hard cap so a malformed query string cannot make the backend fan out
    // across hundreds of sites and burn the call budget in one request.
    if (ids.length >= 24) break;
  }
  if (ids.length === 0) return cfg;

  const byId = new Map(SITE_REGISTRY.map((s) => [s.siteId, s]));
  const sites: SiteDescriptor[] = ids.map(
    (siteId) =>
      byId.get(siteId) ?? {
        siteId,
        fallbackName: `SolarEdge Site ${siteId}`,
        fallbackPeakPowerKwp: 0,
        fallbackCity: '',
      }
  );

  return { ...cfg, sites };
}
