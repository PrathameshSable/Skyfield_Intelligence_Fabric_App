# Skyfield Intelligence — Live Flight Intelligence on Microsoft Fabric

A cinematic **3D globe of live aircraft**, built as a Microsoft **Fabric app (Rayfin)**.
Real aircraft positions from [adsb.fi](https://adsb.fi) open data are streamed through **Fabric
Real-Time Intelligence** (Eventstream → Eventhouse), exposed through a Power BI
**semantic model**, and rendered with React + react-three-fiber inside the Fabric
portal.

![Skyfield — globe overview](docs/media/skyfield-overview.png)

| Drill into a country and follow an aircraft | Colour by altitude, night lighting |
|---|---|
| ![Aircraft detail](docs/media/skyfield-aircraft-detail.png) | ![Altitude + night](docs/media/skyfield-altitude-night.png) |

![Auto-orbit](docs/media/skyfield-orbit.gif)

> Screenshots are the **demo mode** (animated sample fleet). Inside the Fabric
> portal the app switches to **LIVE · Fabric** and plots the aircraft currently
> in the Eventhouse.

## Architecture (as deployed)

```
adsb.fi /api/v3 (one region per run) + adsbdb route / airline enrichment
        │  Fabric notebook: opensky_to_eventstream (Python kernel, started/stopped from the app)
        ▼
Eventstream "flights"  (Custom endpoint source "flight_pipe")
        │
        ▼
Eventhouse "Flight_api" → KQL DB "Flight_api" → table Flights   (15-min retention)
        │  AzureDataExplorer.Contents, DirectQuery
        ▼
Semantic model "Flights"  ──DAX (TOPN 6000 by ingestedAt)──►  Skyfield Rayfin app
                                                              (AppBackend, static hosting)
```

| Fabric item (workspace *Fabric Apps Demos*) | Type | In this repo |
|---|---|---|
| `skyfield-flight-intelligence` | AppBackend (Rayfin app) | [`skyfield-flight-intelligence/`](skyfield-flight-intelligence) — source |
| `Flights` | Semantic model (DirectQuery → Eventhouse) | [`fabric-items/Flights.SemanticModel`](fabric-items/Flights.SemanticModel) — TMDL |
| `Flights` | Report | [`fabric-items/Flights.Report`](fabric-items/Flights.Report) — PBIR |
| `Flight_api` | Eventhouse + KQL database | [`fabric-items/Flight_api.Eventhouse`](fabric-items/Flight_api.Eventhouse), [`fabric-items/Flight_api.KQLDatabase`](fabric-items/Flight_api.KQLDatabase) — schema, ingestion mapping, retention |
| `flights` | Eventstream | [`fabric-items/flights.Eventstream`](fabric-items/flights.Eventstream) — topology |
| `opensky_to_eventstream` | Notebook | [`fabric-notebooks/opensky_to_eventstream.py`](fabric-notebooks/opensky_to_eventstream.py) — adsb.fi feed (Nov 2026), no secrets in it |

`fabric-items/` uses the Fabric Git-integration folder format (`<name>.<Type>/` with
`.platform`), so the items can be re-created via Fabric Git integration or the
`updateDefinition` / `createItem` REST APIs.

## Features

- **3D Earth** with day/night textures, fresnel atmosphere, starfield, auto-orbit
- **Aircraft as an instanced mesh** (up to 5,000) coloured by **country** or **altitude**
- **Great-circle flight paths** and airport markers from route enrichment
- **Click / follow any aircraft**: callsign, route, airline, aircraft type, altitude, speed, heading
- **HUD**: KPI strip, busiest-airspace bars, altitude-band histogram, aircraft-maker bars — all click-to-filter
- **Search & filter** by callsign / ICAO24 / country / airline / maker / altitude band
- Fits the fixed **1280×720 Fabric canvas** with zero page scroll

## Repository layout

```
skyfield-flight-intelligence/   The Rayfin app (Vite + React 18 + three.js / r3f, @microsoft/fabric-app-data)
fabric-items/                   Exported Fabric item definitions (semantic model, report, Eventhouse, KQL DB, Eventstream)
fabric-notebooks/               adsb.fi → Eventstream feed notebook (Python)
fabric-live-api-backend/        Optional Node/TS ingestion + write-back service (alternative to the notebook)
FABRIC_DEPLOYMENT.md            End-to-end runbook: publish shell → build pipeline → go live
docs/media/                     Screenshots and GIF
```

## Run locally (demo mode)

```bash
cd skyfield-flight-intelligence
npm install
npm run dev        # http://localhost:5174 — animated sample fleet, no Fabric needed
npm test           # vitest (geo, great-circle, filter specs)
```

## Deploy / redeploy to Fabric

See [FABRIC_DEPLOYMENT.md](FABRIC_DEPLOYMENT.md). In short:

```bash
cd skyfield-flight-intelligence
cp fabric.yaml.example fabric.yaml            # workspaceId + semantic model itemId
cp rayfin/rayfin.yml.example rayfin/rayfin.yml
npx rayfin login
npx rayfin up --dry-run                       # check the target first
npx rayfin up
```

`fabric.yaml`, `rayfin/rayfin.yml` and `rayfin/.deployments.json` are personal
config and are git-ignored. `.deployments.json` (the pointer to the existing
AppBackend item) was not part of the surviving backup, so on a fresh machine
confirm with `--dry-run` that `rayfin up` targets the existing
`skyfield-flight-intelligence` AppBackend rather than creating a new one.

## Live feed (Start / Stop in the app)

OpenSky times out from Fabric (Azure egress is blocked), so since 2026-11-11 the
feed notebook polls [adsb.fi open data](https://github.com/adsbfi/opendata)
instead: one region per run (Europe, UK & Ireland, US East, Gulf, India), 250 NM
circles at 1 request/s, a sweep every ~20–40 s. The country comes from the ICAO
24-bit address block; routes come from adsbdb and are cached in
`MK_Lakehouse/Files/skyfield_cache.json`. The notebook reads the Eventstream
connection at run time, so it holds no secrets.

Inside Fabric the **Controls** panel has a feed switch: pick a region and run
length, **Start** runs the notebook through the Fabric job API
(`jobType=RunNotebook` with `region` / `run_minutes` parameters), **Stop**
cancels it. It needs Contributor on the workspace, takes 1–3 min to start, and
stops by itself at the end of the run. The globe shows only aircraft seen in
the last 10 minutes (`LIVE_WINDOW_MINUTES`, server clock), because the table's
retention purge lags. Sign-in is a silent MSAL token for app
registration *All Fabric Apps - Demo* (`b443fe41…`), whose SPA redirect list
must include the app's hosting URL and `<hosting URL>/auth-popup.html`.

adsb.fi data is for personal, non-commercial use and needs attribution, shown in
the app. Coverage is good in Europe and the US, thinner in India and Asia.

## Provenance

The original working copy was lost in a 2026 laptop rebuild. This repo was
restored from a June 2026 backup on 2026-10-07 and **verified byte-identical to
the deployed app**: a production build of `skyfield-flight-intelligence/` (with
the real `fabric.generated.ts` ids) reproduces the live `index.html`,
`assets/index-A1pYMhnA.js`, `assets/index-UZLMZtKs.css` and both Earth textures
exactly. The Fabric item definitions were exported from the workspace the same
day via `getDefinition`. On 2026-11-11 the app was changed (adsb.fi feed with
Start/Stop) and redeployed with Rayfin CLI 1.36.2 and `assetAccess: protected`,
so it no longer matches that June build.

---

Fan / learning project for Fabric + Rayfin + react-three-fiber, inspired by
[jeantimex/flights-tracker](https://github.com/jeantimex/flights-tracker).
Aircraft data: [adsb.fi](https://adsb.fi) (earlier builds: OpenSky Network);
route enrichment via [adsbdb](https://www.adsbdb.com). MIT licensed.
