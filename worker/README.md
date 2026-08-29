# SolarEdge Backend (`worker/`)

Holds the SolarEdge OAuth credentials server-side and serves the dashboard one
JSON endpoint. The browser never sees a client id, a client secret, or an
access token.

```
browser ──GET /api/solaredge/overview──▶ worker/ ──Authorization: Bearer──▶ SolarEdge
```

## Why this exists

SolarEdge retired `?api_key=…`. The replacement is an OAuth2 app with a
`CLIENT_ID` / `CLIENT_SECRET` pair — a long-lived credential that must not ship
in a browser bundle. Anything holding it has to be a server.

## Layout

| File | Role |
| --- | --- |
| `src/config.ts` | Env parsing, endpoint URLs, the site registry |
| `src/tokenStore.ts` | Token acquisition, caching, single-flight, refresh-token rotation |
| `src/solaredge.ts` | Data API client, response normalisation, server-side cache |
| `src/handler.ts` | Routes — runtime-agnostic `Request → Response` |
| `node-server.ts` | Node adapter (local dev + kiosk PC) |
| `worker.ts` + `wrangler.toml` | Cloudflare Workers adapter |

Both adapters call the same `handleRequest`, so behaviour cannot drift between
the machine you test on and the one that runs the ceremony.

## Running it

```bash
npm run worker
```

Then the dashboard in another terminal (`npm run dev`), or both at once with
`npm run dev:all`. Vite proxies `/api/solaredge` → `http://localhost:8787`.

In production, put the backend behind the same hostname as the dashboard (an
Nginx/Caddy `location /api/solaredge` block) so the call stays same-origin and
CORS never enters the picture.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/solaredge/overview` | Sites + overviews for all configured sites. `?refresh=1` bypasses the server cache. |
| `GET /api/solaredge/health` | Per-site authorization state, token TTLs, configured site IDs. Never returns the secret. |
| `GET /api/solaredge/auth/connect-url` | The SolarEdge Connect URL to open, plus which sites are still pending. |
| `GET /api/solaredge/auth/exchange?code=…&site_id=…` | Finishes one site's authorization. |
| `GET /api/solaredge/auth/revoke?site_id=…` | Revokes and forgets one site's grant. |

## Authorization — SolarEdge Connect

**A grant covers ONE site.** Three sites means three trips through the consent
screen, each returning its own refresh token. This is why every token in this
backend is keyed by site id.

**`client_credentials` is not supported.** Verified against the live token
endpoint with no credentials sent:

```
POST /v2/oauth2/token  grant_type=client_credentials -> unsupported_grant_type
POST /v2/oauth2/token  grant_type=authorization_code -> invalid_client   (supported)
POST /v2/oauth2/token  grant_type=refresh_token      -> invalid_client   (supported)
```

`invalid_client` means "that grant is fine, you just did not authenticate";
`unsupported_grant_type` means the grant is refused outright. There is no
unattended path that skips a human, and no way to construct the consent URL by
hand either — `POST /v2/oauth2/authorize` answers `invalid_provision_key`,
a Kong API Gateway internal that only SolarEdge's own UI holds.

### The flow

1. **Open the consent page.** Click **เชื่อมต่อ SolarEdge** in the dashboard's
   settings modal — it opens a new tab at:
   ```
   https://connect.solaredge.com/authorize?client_id=<CLIENT_ID>
   ```
   (The button is preferred over the raw URL: the backend builds it, so the
   client id stays in one place.)

2. **Sign in and approve.** Use the SolarEdge account that owns the site, and
   approve the requested scopes. `SITE_DATA` is enough for this dashboard;
   `DEVICE_DATA` is only needed for per-inverter readings.

3. **SolarEdge returns you to the dashboard.** It redirects to the app's
   **DEFAULT** Redirect URL carrying `?code=…&site_id=…`. The dashboard picks
   both up automatically, hands them to the backend, strips them from the
   address bar, and switches to live data.

4. **Repeat for each remaining site.** The settings panel shows a per-site
   checklist and how many are left.

### Redirect URLs

The registered Redirect URLs must match exactly, and the one marked **DEFAULT**
is where SolarEdge actually sends the callback:

| Label | URL | Used by |
| --- | --- | --- |
| `dev` (default) | `http://localhost:3000` | `npm run dev` |
| `server` | `http://localhost:3001` | the Docker deployment |

A mismatch is the first thing SolarEdge checks:

```json
{"error":"invalid_request",
 "error_description":"Invalid redirect_uri that does not match with any redirect_uri created with the application"}
```

> Note the exchange itself sends **no** `redirect_uri` — SolarEdge Connect uses
> the app's default and rejects the call when an unexpected one is supplied.

### Token lifecycle

Access tokens last **2 hours**. The backend refreshes each site's token about a
minute before expiry, with a single-flight guard so two concurrent requests
cannot both spend the refresh token.

> **Refresh tokens rotate and are single-use.** Every refresh returns a new
> access token *and* a new refresh token, and the old one dies immediately.
> That is why `worker/.token-store.json` exists — without it, a Monday-morning
> restart authenticates with Friday's dead token and the dashboard comes up
> empty with no obvious cause. Do not delete that file, and never run two
> backends against the same site.

### Disconnecting

```bash
curl "http://localhost:8787/api/solaredge/auth/revoke?site_id=4956359"
```

Revokes upstream and forgets the token locally. Reconnecting means going
through the consent screen again.

## Configuration

Copy `.dev.vars.example` to `.dev.vars`. Both are read by `npm run worker` and
by `wrangler dev`.

| Variable | Notes |
| --- | --- |
| `SOLAREDGE_CLIENT_ID` / `SOLAREDGE_CLIENT_SECRET` | Required. Secret — never commit, never place under `public/`. |
| `SOLAREDGE_REFRESH_TOKEN_<siteId>` | Optional per-site seed; the connect flow normally writes these for you. |
| `SOLAREDGE_TOKEN_URL` | Default `https://monitoringapi.solaredge.com/v2/oauth2/token`. |
| `SOLAREDGE_API_BASE` | Default `https://monitoringapi.solaredge.com/v2`. |
| `SOLAREDGE_SITE_IDS` | `4956359,4821237,4947126`. Narrows the registry in `src/config.ts`. |
| `ALLOWED_ORIGINS` | CORS allow-list. Leave empty when same-origin. |
| `PORT` | Node adapter only. Default `8787`. |

On Cloudflare, set the two secrets with `wrangler secret put` rather than
putting them in `wrangler.toml`.

## Sites

| Building | Site | Site ID |
| --- | --- | --- |
| 3 | ตรัง | `4821237` |
| 4 | หาดใหญ่ | `4956359` |
| 5 | ปัตตานี | `4947126` |
| 1 | สุราษฎร์ธานี | *not provisioned* |
| 2 | ภูเก็ต | *not provisioned* |

สุราษฎร์ธานี and ภูเก็ต have no site ID yet, so they stay unbound and render as
"ไม่มีข้อมูล" in live mode rather than borrowing a neighbour's figures. When
their IDs are issued, add them to `SITE_REGISTRY` in `src/config.ts`, to
`SOLAREDGE_SITE_IDS`, and to the default bindings in
`src/services/solarEdgeService.ts`.

## Behaviour worth knowing

- **A failed site is absent, never faked.** It appears in `errors[]` with no
  overview, and the dashboard renders "ไม่มีข้อมูล". On a 72" screen an invented
  number is indistinguishable from a real one, so the backend never invents one.
- **The server cache (4.5 min) is what actually protects the API budget.** A
  second browser tab, an F5 on the kiosk, or a colleague opening the dashboard
  all share one upstream fetch.
- **A total outage serves the last good payload** with `staleReason` set, rather
  than blanking the screen. Only rounds that produced at least one reading are
  cached, so a blip cannot be pinned for 4.5 minutes.
- **Cloudflare caveat:** both caches live in isolate memory, and several
  isolates may run. Move them to a Durable Object or KV if that ever matters
  against the API budget — and note the refresh-token persister is a no-op
  there, so Workers needs KV before rotation is safe.
