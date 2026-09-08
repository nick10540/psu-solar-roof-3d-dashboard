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

Create a `.env` next to `docker-compose.yml` — copy [`.env.example`](.env.example)
and fill in the two required secrets:

```bash
# Who may open the dashboard at all (HTTP Basic auth, enforced by nginx).
BASIC_AUTH_USER=psu
BASIC_AUTH_PASSWORD=$(openssl rand -base64 18)

# The SolarEdge Fleet API Key, used only inside the backend container.
SOLAREDGE_API_KEY=your_fleet_api_key
```

Both are **required**: compose fails fast if either is missing, so the stack
cannot come up with the board exposed or the backend blind. Then:

```bash
docker compose up -d --build
```

Open http://localhost:3001 and enter the credentials. Stop with
`docker compose down`.

### Access control

nginx applies Basic auth at **server** level, so it covers the SPA, the hashed
assets, the service worker and the `/api/solaredge` proxy in one place — a
location added to `docker/nginx.conf` later is protected by default. `/healthz`
is the only exempt path, because docker's healthcheck sends no credentials and
the response is a fixed `ok`.

The credentials never enter an image layer or git: they arrive through the
compose environment and
[`docker/docker-entrypoint.d/25-basic-auth.sh`](docker/docker-entrypoint.d/25-basic-auth.sh)
turns them into `/etc/nginx/.htpasswd` at container start. With none set, that
script exits non-zero and nginx never serves a byte — an unprotected dashboard
is not an available failure mode.

| Variable | | Purpose |
| --- | --- | --- |
| `BASIC_AUTH_USER` | required | Username |
| `BASIC_AUTH_PASSWORD` | required | Password, hashed at start-up (apr1) |
| `BASIC_AUTH_REALM` | optional | Text in the browser's password prompt |
| `BASIC_AUTH_ALLOW_IPS` | optional | Comma-separated CIDRs that skip the prompt |
| `BASIC_AUTH_HTPASSWD` | optional | Pre-hashed line(s); wins over user/password |

`BASIC_AUTH_ALLOW_IPS` is there for the kiosk: give it the TV PC's address and
the 72" board comes back up unattended after a power cut, while the same URL
still asks everyone else for the password. It matches the **direct peer**
(`$remote_addr`), not `X-Forwarded-For` — so if another reverse proxy is ever
put in front of this container, every request will arrive from that proxy's
address and an entry covering it would wave everyone through unauthenticated.
Leave it empty in that setup.

Changing the password is `docker compose up -d --force-recreate
psu-solar-roof-dashboard` — the hash is rebuilt on every start, so no rebuild
is needed.

> **Basic auth sends the password on every request, base64-encoded, not
> encrypted.** On the campus LAN behind nginx that is the intended trade for a
> board that any browser can open with no session state. If this ever gets a
> public hostname, put TLS in front of it first.

The dev server can use the same gate: `npm run dev` binds `0.0.0.0`, so setting
`BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` in the environment makes Vite ask
for them too (see `basicAuth()` in `vite.config.ts`). Unset, local development
is unchanged.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Frontend only, port 3000 |
| `npm run worker` | Backend only, port 8787, with watch |
| `npm run dev:all` | Both, side by side |
| `npm run build` | Production frontend build into `dist/` |
| `npm run lint` | Typecheck frontend **and** worker |

## Sites

| # | Site | SolarEdge Site ID | Capacity (kWp) |
| --- | --- | --- | --- |
| 1 | สุราษฎร์ธานี | `4817295` | 996.75 |
| 2 | ภูเก็ต | *not provisioned* | 972 |
| 3 | ตรัง | `4821237` | 997.2 |
| 4 | หาดใหญ่ | `4956359`, `4956575`, `4956547` | 5839.65 |
| 5 | ปัตตานี | `4947126` | 2469.6 |
| | **รวมทั้งหมด** | | **11,275.20** |

Capacity is the as-built commissioned figure, held in
[`src/config/siteCapacity.ts`](src/config/siteCapacity.ts) and revised on
2026-09-08. It is a **specification**, not a measurement — a pin prints it
whether or not an inverter is talking to us — so it is the one figure an
unbound site still shows. The total is summed from that table by
`totalFixedCapacityKwp`, not stored separately, so editing a row moves the
headline with it.

These are **not** the `peakPower` values SolarEdge holds against each
registration. Those are in `worker/src/config.ts` as offline fallbacks, are
documented in [worker/README.md](worker/README.md), and disagree on purpose —
see the note under the หาดใหญ่ table below.

ภูเก็ต has no SolarEdge site ID yet and is deliberately left unbound: in live
mode its power, energy and CO2 read "ไม่มีข้อมูล" rather than showing a
plausible invented figure, while its capacity still prints. In mock mode it
displays simulated data like the others.

หาดใหญ่'s array is split across **three** SolarEdge registrations:

| Site ID | Registration | Registered |
| --- | --- | --- |
| `4956359` | วิทยาเขตหาดใหญ่ | 1500 kWp |
| `4956575` | ศูนย์พัฒนายานยนต์ไฟฟ้า | 46.08 kWp |
| `4956547` | อุทยานวิทยาศาสตร์ | 221.76 kWp |

A pin may aggregate up to `MAX_SITE_IDS_PER_BUILDING` (3) of them, and every
figure it shows — power, energy, CO2 — is the sum across them. The default
binding lives in `src/services/solarEdgeService.ts` (`HATYAI_SITE_IDS`); an
operator can override it per pin from the binding modal, and that choice
persists in localStorage. The capacity the board prints is still the commissioned
5839.65 kWp from `src/config/siteCapacity.ts`, not the 1767.84 kWp these three
register between them — the rest of the array is not readable through the API.

## Security

- **The dashboard is behind HTTP Basic auth**, applied by nginx to the whole
  origin. See [Access control](#access-control) for the variables and the
  reasoning; the short version is that `BASIC_AUTH_USER` and
  `BASIC_AUTH_PASSWORD` are required and the container will not start without
  them.
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
