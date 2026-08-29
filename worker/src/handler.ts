/**
 * handler.ts — Runtime-agnostic HTTP surface (Web Fetch API in, out).
 *
 * The same function backs both adapters: `node-server.ts` for the kiosk PC and
 * local dev, `worker.ts` for Cloudflare. Nothing here touches a Node or a
 * Workers global, which is what keeps the two deployments honest about being
 * the same backend.
 *
 * Routes
 *   GET /api/solaredge/overview[?refresh=1]     sites + overviews for the dashboard
 *   GET /api/solaredge/health                   liveness + per-site authorization state
 *   GET /api/solaredge/auth/connect-url         the SolarEdge Connect consent URL
 *   GET /api/solaredge/auth/exchange?code&site_id   finish an authorization
 *   GET /api/solaredge/auth/revoke?site_id      disconnect one site
 */

import { buildConnectUrl, ConfigError, resolveConfig, WorkerEnv } from './config.js';
import { clearOverviewCache, fetchAllOverviews, upstreamCallsToday } from './solaredge.js';
import {
  authorizedSiteIds,
  exchangeAuthorizationCode,
  hasRefreshToken,
  revokeSite,
  tokenTtlSeconds,
  TokenError,
} from './tokenStore.js';

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

  // Config is resolved before CORS so a missing secret cannot be mistaken for
  // a CORS failure in the browser console.
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

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------
  if (path === '/api/solaredge/health' || path === '/health') {
    const usingApiKey = cfg.authMode === 'api_key';

    // A Fleet API Key covers the whole fleet, so every site counts as
    // authorized without a per-site grant.
    const siteStatus = cfg.sites.map((s) => ({
      siteId: s.siteId,
      name: s.fallbackName,
      authorized: usingApiKey || hasRefreshToken(s.siteId),
      accessTokenTtlSec: usingApiKey ? null : tokenTtlSeconds(s.siteId),
    }));
    const authorized = siteStatus.filter((s) => s.authorized).length;

    return json(
      {
        // With OAuth a grant is per site, so "ok" means every configured site
        // is connected. Reporting ok:true with one site missing would hide
        // exactly the gap somebody needs to see.
        ok: authorized === siteStatus.length,
        authMode: cfg.authMode,
        siteIds: cfg.sites.map((s) => s.siteId),
        sites: siteStatus,
        authorizedCount: authorized,
        totalSites: siteStatus.length,
        tokenUrl: cfg.tokenUrl,
        apiBase: cfg.apiBase,
        // Never the secret itself — just enough to confirm which credential is
        // loaded when two environments are being compared.
        clientIdPreview: usingApiKey
          ? `apikey:${(cfg.apiKey as string).slice(0, 6)}…`
          : `${cfg.clientId.slice(0, 8)}…`,
        upstreamCallsToday: upstreamCallsToday(),
        message: usingApiKey
          ? null
          : authorized === siteStatus.length
            ? null
            : `ยังไม่ได้เชื่อมต่อ ${siteStatus.length - authorized} จาก ${siteStatus.length} ไซต์ — กด "เชื่อมต่อ SolarEdge"`,
      },
      200,
      cors
    );
  }

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  /** The URL to open so the operator can approve one site. */
  if (path === '/api/solaredge/auth/connect-url') {
    if (cfg.authMode === 'api_key') {
      return json(
        {
          ok: false,
          error: 'not_needed',
          message: 'กำลังใช้ Fleet API Key อยู่แล้ว — ไม่ต้องผ่านหน้า consent',
        },
        400,
        cors
      );
    }

    return json(
      {
        ok: true,
        url: buildConnectUrl(cfg, url.searchParams.get('external_id') || undefined),
        // SolarEdge Connect refuses a signing-in user who owns more than one
        // site. If that happens, a Fleet API Key is the way through — the UI
        // needs to be able to say so.
        multiSiteHint:
          'ถ้า SolarEdge แจ้งว่า "associated to multiple SolarEdge sites" ให้ใช้ Fleet API Key แทน (SOLAREDGE_API_KEY)',
        // SolarEdge grants ONE site per trip through the consent screen, so
        // the UI has to say how many trips are left.
        pendingSiteIds: cfg.sites.map((s) => s.siteId).filter((id) => !hasRefreshToken(id)),
        authorizedSiteIds: authorizedSiteIds(),
      },
      200,
      cors
    );
  }

  /**
   * Finish an authorization. SolarEdge appends `code` and `site_id` to the
   * app's default Redirect URL; both are required because the grant is stored
   * against the site it was issued for.
   */
  if (path === '/api/solaredge/auth/exchange') {
    const code = url.searchParams.get('code');
    const siteIdRaw = url.searchParams.get('site_id');
    const siteId = Number(siteIdRaw);

    if (!code) {
      return json(
        { error: 'missing_code', message: 'ไม่พบ ?code= จากหน้า consent ของ SolarEdge' },
        400,
        cors
      );
    }
    if (!siteIdRaw || !Number.isFinite(siteId)) {
      return json(
        { error: 'missing_site_id', message: 'ไม่พบ ?site_id= จาก callback ของ SolarEdge' },
        400,
        cors
      );
    }

    // Refuse a site nobody asked for. Without this, a stray callback could
    // quietly add an unrelated site's grant to the dashboard's store.
    const known = cfg.sites.some((s) => s.siteId === siteId);
    if (!known) {
      return json(
        {
          error: 'unknown_site',
          message: `ไซต์ ${siteId} ไม่อยู่ในรายการที่ตั้งค่าไว้ (${cfg.sites.map((s) => s.siteId).join(', ')})`,
        },
        400,
        cors
      );
    }

    try {
      const result = await exchangeAuthorizationCode(cfg, code, siteId);
      // A new grant can change what the API returns — drop the cached round.
      clearOverviewCache();

      const pending = cfg.sites.map((s) => s.siteId).filter((id) => !hasRefreshToken(id));
      return json(
        {
          ok: true,
          siteId,
          expiresInSec: result.expiresInSec,
          pendingSiteIds: pending,
          message: pending.length
            ? `เชื่อมต่อไซต์ ${siteId} สำเร็จ — เหลืออีก ${pending.length} ไซต์ (${pending.join(', ')})`
            : `เชื่อมต่อไซต์ ${siteId} สำเร็จ — ครบทุกไซต์แล้ว`,
        },
        200,
        cors
      );
    } catch (err) {
      if (err instanceof TokenError) {
        return json(
          { error: 'exchange_failed', message: err.message, detail: err.detail, siteId },
          400,
          cors
        );
      }
      throw err;
    }
  }

  /** Disconnect one site: revoke upstream, then forget it locally. */
  if (path === '/api/solaredge/auth/revoke') {
    const siteId = Number(url.searchParams.get('site_id'));
    if (!Number.isFinite(siteId)) {
      return json({ error: 'missing_site_id', message: 'ต้องระบุ ?site_id=' }, 400, cors);
    }

    await revokeSite(cfg, siteId);
    clearOverviewCache();
    return json({ ok: true, siteId, message: `ยกเลิกการเชื่อมต่อไซต์ ${siteId} แล้ว` }, 200, cors);
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------
  if (path === '/api/solaredge/overview') {
    const forceRefresh = url.searchParams.get('refresh') === '1';

    // fetchAllOverviews reports every failure per site rather than throwing:
    // one unauthorized site must not blank out the ones that do work.
    const payload = await fetchAllOverviews(cfg, { forceRefresh });
    return json(payload, 200, cors);
  }

  return json({ error: 'not_found', path }, 404, cors);
}
