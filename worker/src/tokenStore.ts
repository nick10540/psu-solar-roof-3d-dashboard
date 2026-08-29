/**
 * tokenStore.ts — OAuth2 token acquisition and caching, PER SITE.
 *
 * ---------------------------------------------------------------------------
 * HOW SOLAREDGE CONNECT ACTUALLY WORKS
 *
 * It is a homeowner-consent flow, and a grant covers ONE site:
 *
 *   1. Send the operator to
 *        https://connect.solaredge.com/authorize?client_id=…
 *   2. They sign in and approve.
 *   3. SolarEdge redirects to the app's DEFAULT Redirect URL with
 *        ?code=…&site_id=…
 *   4. The backend POSTs that code (JSON body) and receives an access token
 *      (2 h) plus a refresh token.
 *   5. Refreshing returns a NEW access token AND a NEW refresh token; the old
 *      refresh token is immediately invalid.
 *
 * `client_credentials` is not supported — the token endpoint answers
 * `unsupported_grant_type`. There is no machine-to-machine path here.
 *
 * Because step 3 returns a site_id, and the API answers 403 with "site OAuth
 * grant doesn't include this site", tokens are stored PER SITE. Three sites
 * means three trips through the consent screen.
 * ---------------------------------------------------------------------------
 *
 * Three properties matter more than they look:
 *
 *  1. JSON BODY. The endpoint documents `Content-Type: application/json`.
 *     Form-encoding appears to parse but is not the documented contract.
 *
 *  2. SINGLE-FLIGHT PER SITE. Two concurrent requests for one site must share
 *     a refresh. Refresh tokens are single-use, so a second concurrent refresh
 *     would spend a token the first one has already replaced and lock the site
 *     out until someone redoes the consent flow by hand.
 *
 *  3. ROTATION IS PERSISTED. Same reason. `setRefreshTokenPersister` lets the
 *     Node adapter write each new token to disk the moment it arrives.
 */

import { ResolvedConfig, TOKEN_DEFAULT_TTL_MS, TOKEN_REFRESH_SKEW_MS } from './config.js';

interface CachedToken {
  accessToken: string;
  /** Absolute epoch ms at which the token stops being usable. */
  expiresAt: number;
  tokenType: string;
}

interface SiteSlot {
  token: CachedToken | null;
  inflight: Promise<CachedToken> | null;
  refreshToken: string | null;
}

/** Keyed by site id — a grant is per site, not per account. */
const slots = new Map<number, SiteSlot>();

function slotFor(siteId: number): SiteSlot {
  let slot = slots.get(siteId);
  if (!slot) {
    slot = { token: null, inflight: null, refreshToken: null };
    slots.set(siteId, slot);
  }
  return slot;
}

// ---------------------------------------------------------------------------
// Refresh-token persistence (injected by the adapter; no-op on Workers)
// ---------------------------------------------------------------------------

type RefreshTokenPersister = (siteId: number, refreshToken: string) => void | Promise<void>;

let persistRefreshToken: RefreshTokenPersister | null = null;

export function setRefreshTokenPersister(fn: RefreshTokenPersister | null): void {
  persistRefreshToken = fn;
}

/** Seed a site's refresh token from durable storage (or env) at boot. */
export function setStoredRefreshToken(siteId: number, refreshToken: string): void {
  slotFor(siteId).refreshToken = refreshToken;
}

export function hasRefreshToken(siteId: number): boolean {
  return !!slots.get(siteId)?.refreshToken;
}

/** Which sites are currently authorized. */
export function authorizedSiteIds(): number[] {
  return [...slots.entries()].filter(([, s]) => !!s.refreshToken).map(([id]) => id);
}

export class TokenError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly siteId: number | null;

  constructor(message: string, status: number, detail = '', siteId: number | null = null) {
    super(message);
    this.name = 'TokenError';
    this.status = status;
    this.detail = detail;
    this.siteId = siteId;
  }
}

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * POST the token endpoint with a JSON body, as the API documents.
 *
 * OAuth errors come back as RFC 6749 `{error, error_description}` at HTTP 400
 * and are deterministic — never retry them, fix the request instead.
 */
async function postToken(
  cfg: ResolvedConfig,
  params: Record<string, string>,
  siteId: number | null
): Promise<TokenResponseBody> {
  const body = {
    ...params,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  };

  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new TokenError(
      'ไม่สามารถเชื่อมต่อ SolarEdge token endpoint ได้',
      502,
      `${cfg.tokenUrl}: ${err instanceof Error ? err.message : String(err)}`,
      siteId
    );
  }

  const rawText = await res.text();
  let parsed: TokenResponseBody = {};
  try {
    parsed = rawText ? (JSON.parse(rawText) as TokenResponseBody) : {};
  } catch {
    // A non-JSON body is itself the diagnostic; truncated below so a stray HTML
    // error page cannot flood the log.
  }

  if (!res.ok || parsed.error) {
    const detail = parsed.error_description || rawText.slice(0, 300);

    // Name the two failures that are actionable, so nobody spends an afternoon
    // rotating secrets over an expired code.
    let message: string;
    if (parsed.error === 'invalid_client') {
      message = 'CLIENT_ID หรือ CLIENT_SECRET ไม่ถูกต้อง';
    } else if (/invalid code/i.test(detail)) {
      message = 'Authorization code ถูกใช้ไปแล้วหรือหมดอายุ — กด "เชื่อมต่อ" ใหม่อีกครั้ง';
    } else if (/invalid refresh_token/i.test(detail)) {
      message = 'Refresh token ใช้ไม่ได้แล้ว — ต้องกด "เชื่อมต่อ" ใหม่';
    } else {
      message = `SolarEdge ปฏิเสธคำขอ token (${parsed.error || `HTTP ${res.status}`})`;
    }

    throw new TokenError(message, res.status === 400 || res.status === 401 ? 401 : 502, detail, siteId);
  }

  if (!parsed.access_token) {
    throw new TokenError(
      'SolarEdge token endpoint ตอบกลับโดยไม่มี access_token',
      502,
      rawText.slice(0, 300),
      siteId
    );
  }

  return parsed;
}

function toCachedToken(parsed: TokenResponseBody): CachedToken {
  // Documented as 7200 (2 hours). The fallback only matters if the field is
  // ever missing, and erring short just refreshes sooner than needed.
  const ttlMs =
    typeof parsed.expires_in === 'number' && parsed.expires_in > 0
      ? parsed.expires_in * 1000
      : TOKEN_DEFAULT_TTL_MS;

  return {
    accessToken: parsed.access_token as string,
    tokenType: parsed.token_type || 'Bearer',
    // Expire early by the skew so a token never dies mid-flight on a request
    // that has already been sent.
    expiresAt: Date.now() + Math.max(0, ttlMs - TOKEN_REFRESH_SKEW_MS),
  };
}

/**
 * Store and persist the rotated refresh token.
 *
 * Every successful exchange returns one, and the previous value is dead the
 * instant this response arrives — so this runs on the success path of BOTH the
 * initial exchange and every refresh, not just when the value looks new.
 */
async function absorbRotation(
  siteId: number,
  slot: SiteSlot,
  parsed: TokenResponseBody
): Promise<void> {
  if (!parsed.refresh_token || parsed.refresh_token === slot.refreshToken) return;
  slot.refreshToken = parsed.refresh_token;
  try {
    await persistRefreshToken?.(siteId, parsed.refresh_token);
  } catch (err) {
    // Losing the write is bad but not fatal until the next restart; the
    // in-memory value still works. Shout loudly rather than dying here.
    console.error(`FAILED to persist rotated refresh token for site ${siteId}:`, err);
  }
}

async function acquireToken(cfg: ResolvedConfig, siteId: number, slot: SiteSlot): Promise<CachedToken> {
  if (!slot.refreshToken) {
    throw new TokenError(
      `ไซต์ ${siteId} ยังไม่ได้เชื่อมต่อ — กด "เชื่อมต่อ SolarEdge" เพื่ออนุญาตสิทธิ์`,
      401,
      'No refresh token stored for this site.',
      siteId
    );
  }

  const parsed = await postToken(
    cfg,
    { grant_type: 'refresh_token', refresh_token: slot.refreshToken },
    siteId
  );
  await absorbRotation(siteId, slot, parsed);
  return toCachedToken(parsed);
}

export interface GetTokenOptions {
  /** Discard the cached token first. Used to retry once after an upstream 401. */
  forceRefresh?: boolean;
}

export async function getAccessToken(
  cfg: ResolvedConfig,
  siteId: number,
  options: GetTokenOptions = {}
): Promise<CachedToken> {
  const slot = slotFor(siteId);

  if (options.forceRefresh) {
    slot.token = null;
    // Do NOT clear `inflight`: a refresh already racing to completion is
    // exactly what this caller wants, and dropping it would start a second one
    // against a refresh token the first has already consumed.
  }

  if (slot.token && slot.token.expiresAt > Date.now()) {
    return slot.token;
  }

  if (slot.inflight) return slot.inflight;

  const pending = acquireToken(cfg, siteId, slot)
    .then((token) => {
      slot.token = token;
      return token;
    })
    .finally(() => {
      if (slot.inflight === pending) slot.inflight = null;
    });

  slot.inflight = pending;
  return pending;
}

/**
 * One-time bootstrap: trade an authorization code for this site's tokens.
 *
 * `redirect_uri` is deliberately NOT sent — SolarEdge Connect uses the app's
 * configured default Redirect URL and rejects the exchange outright when an
 * unexpected one is supplied.
 */
export async function exchangeAuthorizationCode(
  cfg: ResolvedConfig,
  code: string,
  siteId: number
): Promise<{ refreshToken: string | null; expiresInSec: number | null }> {
  const parsed = await postToken(cfg, { grant_type: 'authorization_code', code }, siteId);
  const slot = slotFor(siteId);

  slot.token = toCachedToken(parsed);
  await absorbRotation(siteId, slot, parsed);

  return {
    refreshToken: parsed.refresh_token ?? null,
    expiresInSec: typeof parsed.expires_in === 'number' ? parsed.expires_in : null,
  };
}

/** Revoke a site's token and forget it, so the UI stops claiming a connection. */
export async function revokeSite(cfg: ResolvedConfig, siteId: number): Promise<void> {
  const slot = slots.get(siteId);
  const token = slot?.refreshToken;

  if (token) {
    try {
      await fetch(cfg.revokeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch (err) {
      // Best effort: the local grant is dropped either way, and leaving a stale
      // token in memory would be worse than a token SolarEdge still honours.
      console.warn(`Revoke call failed for site ${siteId}:`, err);
    }
  }

  slots.delete(siteId);
  try {
    await persistRefreshToken?.(siteId, '');
  } catch (err) {
    console.error(`Failed to clear persisted token for site ${siteId}:`, err);
  }
}

/** Seconds of life left on a site's cached access token, for /health. */
export function tokenTtlSeconds(siteId: number): number | null {
  const slot = slots.get(siteId);
  if (!slot?.token) return null;
  return Math.max(0, Math.round((slot.token.expiresAt - Date.now()) / 1000));
}

/** Test / ops hook: drop every cached token. */
export function clearTokenCache(): void {
  slots.clear();
}
