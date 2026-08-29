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
| Backend | `worker/` | Holds the SolarEdge Fleet API Key, calls the v2 API, caches responses. See [worker/README.md](worker/README.md). |

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

Paste a **Fleet API Key** into `SOLAREDGE_API_KEY`. Generate it in the SolarEdge
Developer Platform with access type **My Fleet Access** — one key covers every
site, with no consent step. See [worker/README.md](worker/README.md).

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
origin and the API key stays inside the backend container.

> This replaces the earlier "static file server, no env vars needed" setup. The
> dashboard used to call SolarEdge straight from the browser with the key in the
> URL; SolarEdge retired that scheme, and the replacement credential cannot ship
> in a browser bundle — so production now needs the backend container too.

Create a `.env` next to `docker-compose.yml` with the backend secrets:

```bash
SOLAREDGE_API_KEY=your_fleet_api_key
```

Then:

```bash
docker compose up -d --build
```

Open http://localhost:3001. Stop with `docker compose down`.

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
| 1 | สุราษฎร์ธานี | *not provisioned* | — |
| 2 | ภูเก็ต | *not provisioned* | — |
| 3 | ตรัง | `4821237` | 999.36 kWp |
| 4 | หาดใหญ่ | `4956359` | 1500 kWp |
| 5 | ปัตตานี | `4947126` | 1522.08 kWp |

Sites 1 and 2 have no SolarEdge site ID yet. They are deliberately left unbound:
in live mode their pins read "ไม่มีข้อมูล" rather than showing a plausible
invented figure. In mock mode they display simulated data like the others.

## Security

- **Never put credentials under `public/`.** Vite copies that directory
  verbatim into `dist/`, so anything there is served to the open internet.
  The API key belongs in `worker/.dev.vars` (gitignored) or, for Docker, the
  compose `.env`.
- `.gitignore` covers `*.env` as well as `.env*`: a file named `solar.env` or
  `fleet.env` is NOT matched by the `.env*` rule alone.

## Design notes

- **Live mode never fabricates.** A site the backend could not read is absent
  from the payload, and the UI renders "ไม่มีข้อมูล". Simulated numbers appear
  only when Mock Simulator is explicitly selected.
- **Two cache layers.** The backend caches upstream responses for 4.5 minutes
  (shared across every viewer); the browser keeps its own SWR cache for the same
  window. A reload or a second tab costs nothing upstream. SolarEdge rate-limits
  per MINUTE, so sites are also fetched sequentially.
- **Kiosk stability.** `useLongRunGuard` watches heap pressure; every callback
  passed to `Solar3DViewer` is memoised because an unstable prop rebuilds the
  entire MapLibre instance. See the header comment in `src/App.tsx`.
