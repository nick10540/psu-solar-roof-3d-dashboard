# PSU / MEA Solar Roof — Interactive 3D Dashboard

A kiosk dashboard for five regional MEA Solar Roof sites in southern Thailand,
built for a 72" screen: a MapLibre/Three.js campus view with per-site media
banners and live production pulled from the SolarEdge Monitoring API.

## Architecture

Two processes. The browser never holds a SolarEdge credential.

```
┌──────────────┐  GET /api/solaredge/overview  ┌───────────┐  Authorization: Bearer  ┌───────────┐
│  Vite SPA    │ ────────────────────────────▶ │  worker/  │ ──────────────────────▶ │ SolarEdge │
│  :3000       │                               │  :8787    │                         │  API v2   │
└──────────────┘                               └───────────┘                         └───────────┘
```

| Part | Where | Role |
| --- | --- | --- |
| Frontend | `src/` | React 19 + Vite 6 + Tailwind v4, MapLibre GL, Three.js |
| Backend | `worker/` | Holds the OAuth client id/secret, mints and refreshes the access token, caches responses. See [worker/README.md](worker/README.md). |

Everything else the dashboard remembers — building bindings, custom buildings,
coordinates, brightness — lives in `localStorage`. Map tiles are cached by the
`sw-tiles.js` service worker so an all-day kiosk makes almost no tile requests
after warm-up.

## Running locally

**Prerequisites:** Node 18+ (developed on 20.x).

```bash
npm install
```

Set up the backend credentials once:

```bash
cp worker/.dev.vars.example worker/.dev.vars
```

Fill in `SOLAREDGE_CLIENT_ID` / `SOLAREDGE_CLIENT_SECRET`, then run the
**SolarEdge Connect** flow in [worker/README.md](worker/README.md) — click
**เชื่อมต่อ SolarEdge** in the settings modal. A grant covers ONE site, so this
runs once per site; the backend refreshes forever after.

Run both processes:

```bash
npm run dev:all
```

Or separately: `npm run worker` (backend, :8787) and `npm run dev` (frontend,
:3000). Vite proxies `/api/solaredge` to the backend.

The dashboard starts in **Mock Simulator** mode. Switch to **SolarEdge Live
API** in the settings modal (⚙ in the header) — there is no key to type; the
backend already knows which sites to read.

## Run with Docker

Two containers: nginx serving the built SPA, and the Node backend behind it at
`/api/solaredge`. Nginx proxies that path, so the browser only ever talks to one
origin and the OAuth credentials stay inside the backend container.

> This replaces the earlier "static file server, no env vars needed" setup. The
> dashboard used to call SolarEdge straight from the browser with an API key;
> SolarEdge retired that scheme, and an OAuth client secret cannot ship in a
> browser bundle — so production now needs the backend container too.

Create a `.env` next to `docker-compose.yml` with the backend secrets:

```bash
SOLAREDGE_CLIENT_ID=your_client_id
SOLAREDGE_CLIENT_SECRET=your_client_secret
SOLAREDGE_REFRESH_TOKEN_4956359=optional_seed_per_site
```

Then:

```bash
docker compose up -d --build
```

Open http://localhost:3001. Stop with `docker compose down`.

> The refresh token rotates on every use, so the backend persists the current
> one to a named volume (`solaredge-token`). Do not delete that volume — see
> [worker/README.md](worker/README.md).

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Frontend only, port 3000 |
| `npm run worker` | Backend only, port 8787, with watch |
| `npm run dev:all` | Both, side by side |
| `npm run build` | Production frontend build into `dist/` |
| `npm run lint` | Typecheck frontend **and** worker |

## Sites

| # | Site | SolarEdge Site ID | Capacity |
| --- | --- | --- | --- |
| 1 | สุราษฎร์ธานี | *not provisioned* | 320 kWp |
| 2 | ภูเก็ต | *not provisioned* | 450 kWp |
| 3 | ตรัง | `4821237` | 250 kWp |
| 4 | หาดใหญ่ | `4956359` | 380 kWp |
| 5 | ปัตตานี | `4947126` | 200 kWp |

Sites 1 and 2 have no SolarEdge site ID yet. They are deliberately left unbound:
in live mode their pins read "ไม่มีข้อมูล" rather than showing a plausible
invented figure. In mock mode they display simulated data like the others.

## Security

- **Never put credentials under `public/`.** Vite copies that directory
  verbatim into `dist/`, so anything there is served to the open internet.
  Backend secrets belong in `worker/.dev.vars` (gitignored) or, for Docker, the
  compose `.env`.
- `worker/.token-store.json` holds the rotating refresh token. Gitignored, and
  it must survive restarts.

## Design notes

- **Live mode never fabricates.** A site the backend could not read is absent
  from the payload, and the UI renders "ไม่มีข้อมูล". Simulated numbers appear
  only when Mock Simulator is explicitly selected.
- **Two cache layers.** The backend caches upstream responses for 4.5 minutes
  (shared across every viewer); the browser keeps its own SWR cache for the same
  window. A reload or a second tab costs nothing upstream.
- **Kiosk stability.** `useLongRunGuard` watches heap pressure; every callback
  passed to `Solar3DViewer` is memoised because an unstable prop rebuilds the
  entire MapLibre instance. See the header comment in `src/App.tsx`.
