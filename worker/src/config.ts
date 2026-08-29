/**
 * config.ts — Runtime configuration for the SolarEdge backend.
 *
 * Everything that differs between local dev, the kiosk PC and a Cloudflare
 * deployment arrives through `WorkerEnv`, so the same handler code runs
 * unchanged on all three. Nothing in here is baked into the browser bundle:
 * the client id / secret never leave this process.
 */

export interface WorkerEnv {
  /**
   * Fleet API Key. When set, this is used INSTEAD of OAuth and covers every
   * site in the fleet with one credential.
   *
   * This is the escape hatch for a multi-site account. SolarEdge Connect —
   * the consent flow — refuses outright when the signing-in user owns more
   * than one site:
   *
   *   "user … is associated to multiple SolarEdge sites.
   *    Multi-site access is not supported yet by this service."
   *
   * A Fleet API Key has no consent step, carries all scopes implicitly, and is
   * sent as `X-API-Key`. Generate one in the SolarEdge Developer Platform under
   * the fleet application.
   */
  SOLAREDGE_API_KEY?: string;

  /** OAuth2 client credentials issued by the SolarEdge Developer Platform. */
  SOLAREDGE_CLIENT_ID: string;
  SOLAREDGE_CLIENT_SECRET: string;

  /**
   * OAuth2 token endpoint. Accepts a JSON body and the
   * authorization_code / refresh_token grants; `client_credentials` is
   * answered with `unsupported_grant_type`, so there is no unattended path
   * that skips the consent screen.
   */
  SOLAREDGE_TOKEN_URL?: string;

  /** Token revocation endpoint, used when disconnecting a site. */
  SOLAREDGE_REVOKE_URL?: string;

  /**
   * SolarEdge Connect consent page. The operator is sent here with the client
   * id; SolarEdge returns them to the app's DEFAULT Redirect URL carrying
   * `?code=…&site_id=…`.
   */
  SOLAREDGE_CONNECT_URL?: string;

  /**
   * Base URL for the data API. Verified: a Bearer probe against
   * /v2/sites/{id}/overview returns `invalid_token`, so both the base and the
   * path template are correct.
   */
  SOLAREDGE_API_BASE?: string;

  /** Comma-separated allow-list of site IDs this backend may read. */
  SOLAREDGE_SITE_IDS?: string;

  /** Comma-separated CORS origins. Empty/absent => same-origin only. */
  ALLOWED_ORIGINS?: string;

  /** Node adapter only. */
  PORT?: string;
}

export const DEFAULT_TOKEN_URL = 'https://monitoringapi.solaredge.com/v2/oauth2/token';
export const DEFAULT_REVOKE_URL = 'https://monitoringapi.solaredge.com/v2/oauth2/revoke-token';
export const DEFAULT_CONNECT_URL = 'https://connect.solaredge.com/authorize';
export const DEFAULT_API_BASE = 'https://monitoringapi.solaredge.com/v2';

/**
 * Serve a cached upstream response for this long.
 *
 * Deliberately just under the dashboard's 5-minute poll, mirroring the client
 * cache. With the backend in place this is what actually protects the API
 * budget: a second browser tab, an F5 on the kiosk, or a colleague opening the
 * dashboard on their laptop all share ONE upstream fetch instead of each
 * spending their own.
 */
export const OVERVIEW_CACHE_TTL_MS = 4.5 * 60 * 1000;

/** Refresh the access token this long before it actually expires. */
export const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

/** Fallback token lifetime when the token response omits `expires_in`. */
export const TOKEN_DEFAULT_TTL_MS = 55 * 60 * 1000;

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
 */
export const SITE_REGISTRY: SiteDescriptor[] = [
  { siteId: 4956359, fallbackName: 'MEA Solar Roof - หาดใหญ่', fallbackPeakPowerKwp: 380.0, fallbackCity: 'หาดใหญ่' },
  { siteId: 4821237, fallbackName: 'MEA Solar Roof - ตรัง', fallbackPeakPowerKwp: 250.0, fallbackCity: 'ตรัง' },
  { siteId: 4947126, fallbackName: 'MEA Solar Roof - ปัตตานี', fallbackPeakPowerKwp: 200.0, fallbackCity: 'ปัตตานี' },
];

/**
 * How the backend authenticates to SolarEdge.
 *
 *  'api_key' — one Fleet API Key covers every site. No consent step, works with
 *              a multi-site account. Preferred whenever a key is available.
 *  'oauth'   — SolarEdge Connect, one grant per site. Blocked for users who own
 *              more than one site, which is why 'api_key' exists.
 */
export type AuthMode = 'api_key' | 'oauth';

export interface ResolvedConfig {
  authMode: AuthMode;
  apiKey: string | null;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  revokeUrl: string;
  connectUrl: string;
  apiBase: string;
  sites: SiteDescriptor[];
  allowedOrigins: string[];
}

/** The consent URL an operator opens to authorize one site. */
export function buildConnectUrl(cfg: ResolvedConfig, externalId?: string): string {
  const url = new URL(cfg.connectUrl);
  url.searchParams.set('client_id', cfg.clientId);
  // Carried through the flow and handed back on the callback. Useful for
  // telling two half-finished authorizations apart; SolarEdge also returns
  // site_id, which is what actually keys the grant.
  if (externalId) url.searchParams.set('external_id', externalId);
  return url.toString();
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
  const apiKey = (env.SOLAREDGE_API_KEY || '').trim() || null;
  const clientId = (env.SOLAREDGE_CLIENT_ID || '').trim();
  const clientSecret = (env.SOLAREDGE_CLIENT_SECRET || '').trim();

  // A Fleet API Key is sufficient on its own — it needs no OAuth app at all —
  // so only demand the client pair when there is no key to fall back on.
  if (!apiKey && (!clientId || !clientSecret)) {
    throw new ConfigError(
      'Set SOLAREDGE_API_KEY (fleet key — works with multi-site accounts), or ' +
        'SOLAREDGE_CLIENT_ID + SOLAREDGE_CLIENT_SECRET for the OAuth consent flow. ' +
        'Copy worker/.dev.vars.example to worker/.dev.vars and fill one of them in.'
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
    authMode: apiKey ? 'api_key' : 'oauth',
    apiKey,
    clientId,
    clientSecret,
    tokenUrl: (env.SOLAREDGE_TOKEN_URL || DEFAULT_TOKEN_URL).trim(),
    revokeUrl: (env.SOLAREDGE_REVOKE_URL || DEFAULT_REVOKE_URL).trim(),
    connectUrl: (env.SOLAREDGE_CONNECT_URL || DEFAULT_CONNECT_URL).trim(),
    apiBase: (env.SOLAREDGE_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, ''),
    sites,
    allowedOrigins: parseCsv(env.ALLOWED_ORIGINS),
  };
}

/**
 * Per-site refresh tokens seeded from the environment, as
 * `SOLAREDGE_REFRESH_TOKEN_<siteId>`. The durable token store wins over these:
 * a rotated token is the only one still valid.
 */
export function seedRefreshTokensFromEnv(env: WorkerEnv): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  for (const [key, value] of Object.entries(env as unknown as Record<string, string | undefined>)) {
    const match = /^SOLAREDGE_REFRESH_TOKEN_(\d+)$/.exec(key);
    if (!match || !value?.trim()) continue;
    out.push([Number(match[1]), value.trim()]);
  }
  return out;
}
