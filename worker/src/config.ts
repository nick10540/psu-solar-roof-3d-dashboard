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

  /** Comma-separated CORS origins. Empty/absent => same-origin only. */
  ALLOWED_ORIGINS?: string;

  /** Node adapter only. */
  PORT?: string;
}

export const DEFAULT_API_BASE = 'https://monitoringapi.solaredge.com/v2';

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
 * The three live sites.
 *
 * สุราษฎร์ธานี and ภูเก็ต are intentionally absent: no site ID has been issued
 * for them yet. They stay unbound on the dashboard and render as "ไม่มีข้อมูล"
 * rather than borrowing a neighbour's numbers. Add them here when their IDs
 * exist and they light up with no other change.
 *
 * The fallback capacities are only used if the API cannot be reached — the
 * real values (1500 / 999.36 / 1522.08 kWp) come from /sites/{id}.
 */
export const SITE_REGISTRY: SiteDescriptor[] = [
  { siteId: 4956359, fallbackName: 'MEA Solar Roof - หาดใหญ่', fallbackPeakPowerKwp: 1500.0, fallbackCity: 'หาดใหญ่' },
  { siteId: 4821237, fallbackName: 'MEA Solar Roof - ตรัง', fallbackPeakPowerKwp: 999.36, fallbackCity: 'ตรัง' },
  { siteId: 4947126, fallbackName: 'MEA Solar Roof - ปัตตานี', fallbackPeakPowerKwp: 1522.08, fallbackCity: 'ปัตตานี' },
];

export interface ResolvedConfig {
  apiKey: string;
  apiBase: string;
  sites: SiteDescriptor[];
  allowedOrigins: string[];
}

export class ConfigError extends Error {}

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
  };
}
