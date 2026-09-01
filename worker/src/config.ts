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
   * Upstream requests allowed per rolling minute. Default 10, the plan's
   * real ceiling. Lower it to leave room for another consumer of the key.
   */
  SOLAREDGE_MAX_CALLS_PER_MIN?: string;

  /**
   * Upstream requests allowed per calendar month. Default 2000, the plan's
   * real ceiling. Once spent, the backend serves cache instead of fetching.
   */
  SOLAREDGE_MONTHLY_CALL_BUDGET?: string;

  /** Comma-separated CORS origins. Empty/absent => same-origin only. */
  ALLOWED_ORIGINS?: string;

  /** Node adapter only. */
  PORT?: string;
}

export const DEFAULT_API_BASE = 'https://monitoringapi.solaredge.com/v2';

/**
 * Plan limits, and why they are enforced here rather than hoped for.
 *
 * The API charges 10 requests per MINUTE and 2000 per MONTH. A cold start
 * costs 4 requests per site (metadata + power + energy + cold totals), so
 * four sites need 16 — the per-minute ceiling is crossed by the fourth site
 * alone, and the last sites in the list come back as 429s. Sequential
 * fetching alone does not fix that; the burst has to actually wait.
 *
 * The monthly figure is the tighter constraint by far: 2000 a month is ~64
 * a day, while a 5-minute poll over four sites spends ~2300. The budget
 * guard below does not paper over that — it stops the overrun being silent.
 */
export const DEFAULT_MAX_CALLS_PER_MIN = 10;
export const DEFAULT_MONTHLY_CALL_BUDGET = 2000;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Serve a cached upstream response for this long.
 *
 * Deliberately just under the dashboard's 5-minute poll, mirroring the client
 * cache. This is what actually protects the API budget: a second browser tab,
 * an F5 on the kiosk, or a colleague opening the dashboard on their laptop all
 * share ONE upstream fetch instead of each spending their own.
 */
export const OVERVIEW_CACHE_TTL_MS = 4.5 * 60 * 1000;

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
  };
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
