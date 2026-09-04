/**
 * handler.ts — Runtime-agnostic HTTP surface (Web Fetch API in, out).
 *
 * The same function backs both adapters: `node-server.ts` for the kiosk PC and
 * local dev, `worker.ts` for Cloudflare. Nothing here touches a Node or a
 * Workers global, which is what keeps the two deployments honest about being
 * the same backend.
 *
 * Routes
 *   GET /api/solaredge/overview   sites + overviews for the dashboard
 *   GET /api/solaredge/health     liveness and configuration
 *
 * Query parameters on /overview
 *   refresh=1              bypass the live pair's TTL (a page load wanting
 *                          numbers now). Leaves the slow totals cached.
 *   sites=<id>,<id>        the site IDs the dashboard actually has on screen
 *   powerSec=<n>           default seconds between /power + today's /energy
 *   energySec=<n>          default seconds between the totals + CO2 calls
 *   siteIntervals=         per-site overrides, "<id>:<powerSec>:<energySec>"
 *     4956359:30:600,...   repeated comma-separated. Either number may be
 *                          blank to inherit the default above.
 *
 * Every interval is clamped server-side to [MIN, MAX]_REFRESH_INTERVAL_SEC —
 * these are hints from the browser, not instructions.
 */

import {
  ConfigError,
  MAX_REFRESH_INTERVAL_SEC,
  MIN_REFRESH_INTERVAL_SEC,
  resolveConfig,
  withRefreshIntervals,
  withRequestedSites,
  WorkerEnv,
} from './config.js';
import {
  fetchAllOverviews,
  upstreamCallsThisMonth,
  upstreamCallsToday,
} from './solaredge.js';

function corsHeaders(request: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin) return {};

  // No allow-list configured => same-origin only, so no CORS headers are sent
  // and the browser enforces it. An explicit list is required to open up.
  if (!allowedOrigins.includes(origin)) return {};

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // The dashboard does its own SWR caching and the backend has a server
      // cache; an intermediary caching this too would only add staleness we
      // cannot see or flush.
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

/**
 * Parse `siteIntervals=<id>:<powerSec>:<energySec>,...`.
 *
 * A malformed entry is skipped rather than failing the whole request: the
 * fallback is the global cadence, which is a working board. Blank numbers mean
 * "inherit", so `4956359:30:` sets only the live interval for that site, and
 * `clampIntervalSec` in config.ts is what enforces the floor on whatever
 * survives this.
 */
function parseSiteIntervals(
  raw: string
): Array<{ siteId: number; powerSec?: number; energySec?: number }> {
  const out: Array<{ siteId: number; powerSec?: number; energySec?: number }> = [];
  if (!raw) return out;

  for (const chunk of raw.split(',')) {
    const [idPart, powerPart, energyPart] = chunk.split(':');
    const siteId = Number((idPart || '').trim());
    if (!Number.isInteger(siteId) || siteId <= 0) continue;

    const asSec = (part: string | undefined): number | undefined => {
      const n = Number((part || '').trim());
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };

    out.push({ siteId, powerSec: asSec(powerPart), energySec: asSec(energyPart) });
    // Same hard cap as withRequestedSites: a crafted query string must not be
    // able to make this backend fan out across hundreds of sites.
    if (out.length >= 24) break;
  }

  return out;
}

export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  // Config is resolved before CORS so a missing key cannot be mistaken for a
  // CORS failure in the browser console.
  let cfg;
  try {
    cfg = resolveConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      return json({ error: 'backend_misconfigured', message: err.message }, 500);
    }
    throw err;
  }

  const cors = corsHeaders(request, cfg.allowedOrigins);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'GET, OPTIONS' });
  }

  if (path === '/api/solaredge/health' || path === '/health') {
    return json(
      {
        ok: true,
        siteIds: cfg.sites.map((s) => s.siteId),
        sites: cfg.sites.map((s) => ({ siteId: s.siteId, name: s.fallbackName })),
        totalSites: cfg.sites.length,
        apiBase: cfg.apiBase,
        // Never the key itself — just enough to confirm which credential is
        // loaded when two environments are being compared.
        apiKeyPreview: `${cfg.apiKey.slice(0, 6)}…`,
        upstreamCallsToday: upstreamCallsToday(),
        upstreamCallsThisMonth: upstreamCallsThisMonth(),
        // The two ceilings this backend holds itself to, so a kiosk can be
        // checked against the plan without reading the source.
        maxCallsPerMin: cfg.maxCallsPerMin,
        monthlyCallBudget: cfg.monthlyCallBudget,
        // The cadence a bare request would get, plus the bounds the backend
        // clamps to, so the settings panel can show the real numbers instead
        // of assuming its own defaults took effect.
        defaultPowerIntervalSec: cfg.refreshIntervals.powerSec,
        defaultEnergyIntervalSec: cfg.refreshIntervals.energySec,
        minRefreshIntervalSec: MIN_REFRESH_INTERVAL_SEC,
        maxRefreshIntervalSec: MAX_REFRESH_INTERVAL_SEC,
      },
      200,
      cors
    );
  }

  if (path === '/api/solaredge/overview') {
    const forceRefresh = url.searchParams.get('refresh') === '1';

    // The dashboard owns the building -> site-ID mapping now, so it asks for
    // exactly the IDs its operator has bound. Absent or unparseable, we fall
    // back to the env-configured set so a bare GET still works.
    const requested = (url.searchParams.get('sites') || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    const scoped = requested.length > 0 ? withRequestedSites(cfg, requested) : cfg;

    // The browser owns the cadence, this backend owns the floor. Absent
    // parameters leave the env-resolved default in place.
    const effective = withRefreshIntervals(scoped, {
      powerSec: url.searchParams.get('powerSec') ?? undefined,
      energySec: url.searchParams.get('energySec') ?? undefined,
      perSite: parseSiteIntervals(url.searchParams.get('siteIntervals') || ''),
    });

    // fetchAllOverviews reports every failure per site rather than throwing:
    // one site hitting a rate limit must not blank out the ones that worked.
    const payload = await fetchAllOverviews(effective, { forceRefresh });
    return json(payload, 200, cors);
  }

  return json({ error: 'not_found', path }, 404, cors);
}
