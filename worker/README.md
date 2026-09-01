# SolarEdge Backend (`worker/`)

Holds the SolarEdge Fleet API Key server-side and serves the dashboard one JSON
endpoint. The browser never sees the key.

```
browser ──GET /api/solaredge/overview──▶ worker/ ──X-API-Key──▶ SolarEdge v2
```

## Why this exists

SolarEdge retired `?api_key=…` in the URL. The replacement is a Fleet API Key
sent as a header — a long-lived credential that must not ship in a browser
bundle. Anything holding it has to be a server.

## Layout

| File | Role |
| --- | --- |
| `src/config.ts` | Env parsing, the site registry |
| `src/solaredge.ts` | v2 data client, response normalisation, caching |
| `src/handler.ts` | Routes — runtime-agnostic `Request → Response` |
| `node-server.ts` | Node adapter (local dev + kiosk PC) |
| `worker.ts` + `wrangler.toml` | Cloudflare Workers adapter |

Both adapters call the same `handleRequest`, so behaviour cannot drift between
the machine you test on and the one that runs the ceremony.

## Setup

1. In the SolarEdge Developer Platform, create an application and choose
   **My Fleet Access** as the access type. That issues an API key covering every
   site visible in your monitoring account.

   > Do **not** pick *Site Access*. That is the OAuth consent flow, and it
   > refuses any user who owns more than one site:
   > *"associated to multiple SolarEdge sites. Multi-site access is not
   > supported yet by this service."* `client_credentials` is not supported by
   > the token endpoint either, so there is no unattended OAuth path at all.

2. ```bash
   cp .dev.vars.example .dev.vars
   ```
   Paste the key into `SOLAREDGE_API_KEY`.

3. ```bash
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
| `GET /api/solaredge/overview` | Sites + readings for every configured site. `?refresh=1` bypasses the server cache. |
| `GET /api/solaredge/health` | Liveness and configuration. Never returns the key. |

## Configuration

| Variable | Notes |
| --- | --- |
| `SOLAREDGE_API_KEY` | Required. Secret — never commit, never place under `public/`. |
| `SOLAREDGE_SITE_IDS` | `4956359,4821237,4947126`. Narrows the registry in `src/config.ts`. |
| `SOLAREDGE_API_BASE` | Default `https://monitoringapi.solaredge.com/v2`. |
| `ALLOWED_ORIGINS` | CORS allow-list. Leave empty when same-origin. |
| `PORT` | Node adapter only. Default `8787`. |

On Cloudflare, set the key with `wrangler secret put SOLAREDGE_API_KEY` rather
than putting it in `wrangler.toml`.

## Sites

| Building | Site | Site ID | Capacity |
| --- | --- | --- | --- |
| 1 | สุราษฎร์ธานี | `4817295` | 650.88 kWp |
| 3 | ตรัง | `4821237` | 999.36 kWp |
| 4 | หาดใหญ่ | `4956359` | 1500 kWp |
| 5 | ปัตตานี | `4947126` | 1522.08 kWp |
| 2 | ภูเก็ต | *not provisioned* | — |

Capacities come from the API. ภูเก็ต has no site ID yet, so it stays unbound and
renders as "ไม่มีข้อมูล" in live mode rather than borrowing a neighbour's
figures. When its ID is issued, add it to `SITE_REGISTRY` in `src/config.ts`, to
`SOLAREDGE_SITE_IDS`, and to the default bindings in
`src/services/solarEdgeService.ts`.

สุราษฎร์ธานี reports `city: "Hat Yai", state: "Changwat Songkhla"` in its site
metadata, unlike the other three whose cities match their names. Treat the
building↔site mapping there as unverified until someone confirms it upstream.

## The v2 API, and the trap in it

**Every endpoint defaults to TODAY**, in site-local time. That includes
`/sites/{id}/overview`, whose `production.total` therefore reports *today's*
production — **not** lifetime. Reading it as lifetime is the easiest way to put
a confidently wrong number on a 72" screen, so this backend does not use that
endpoint at all.

Verified against site 4956359 on 2026-08-29:

```
DAY buckets    26th=19,870  27th=243,854  28th=361,482  29th=173,630 Wh
MONTH bucket   Aug = 798,836 Wh          (exactly the sum of the days)
/overview      173,630 Wh                (= the 29th alone)
```

Everything is therefore derived from explicit ranges:

| Figure | Source |
| --- | --- |
| Current power | `/sites/{id}/power`, **last non-null** sample (never summed — adding watt readings is meaningless) |
| Today | `/sites/{id}/energy`, summed |
| Month / year / lifetime | `/sites/{id}/energy?resolution=MONTH` since installation — one request for all three |

Site metadata is also reshaped from v1: `siteId` not `id`, `activationStatus`
(upper case) not `status`, `location.timezone` not `timeZone`, `note` not
`notes`, and no `currency` / `type` / `primaryModule`.

## Behaviour worth knowing

- **Rate limiting is per MINUTE** (`x-ratelimit-remaining-minute`,
  `retry-after`), not per day — roughly 10–20 requests. Sites are fetched
  **sequentially** for that reason, and slow-moving totals are cached for 30
  minutes against the 4.5-minute live cache, keeping a poll to two requests per
  site.
- **A failed site is absent, never faked.** It appears in `errors[]` with no
  reading, and the dashboard renders "ไม่มีข้อมูล". On a 72" screen an invented
  number is indistinguishable from a real one, so the backend never invents one.
- **Zero is not "no data".** A site reporting 0 kW at night is a real
  measurement and is shown as such; a site that reported nothing at all is
  reported as an error.
- **The server cache is what actually protects the API budget.** A second
  browser tab, an F5 on the kiosk, or a colleague opening the dashboard all
  share one upstream fetch.
- **Cloudflare caveat:** the caches live in isolate memory and several isolates
  may run, so each warms its own. Move them to a Durable Object or KV if that
  ever matters against the budget.
