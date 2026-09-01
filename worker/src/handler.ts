/**
 * handler.ts — Runtime-agnostic HTTP surface (Web Fetch API in, out).
 *
 * The same function backs both adapters: `node-server.ts` for the kiosk PC and
 * local dev, `worker.ts` for Cloudflare. Nothing here touches a Node or a
 * Workers global, which is what keeps the two deployments honest about being
 * the same backend.
 *
 * Routes
 *   GET /api/solaredge/overview[?refresh=1]  sites + overviews for the dashboard
 *   GET /api/solaredge/health                liveness and configuration
 */

import {
  ConfigError,
  resolveConfig,
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
    const effective = requested.length > 0 ? withRequestedSites(cfg, requested) : cfg;

    // fetchAllOverviews reports every failure per site rather than throwing:
    // one site hitting a rate limit must not blank out the ones that worked.
    const payload = await fetchAllOverviews(effective, { forceRefresh });
    return json(payload, 200, cors);
  }

  return json({ error: 'not_found', path }, 404, cors);
}
