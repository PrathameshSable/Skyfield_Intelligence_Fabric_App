# Skyfield — Live Flight Intelligence

A cinematic **3D globe of live aircraft**, built with React + react-three-fiber
for the Microsoft **Fabric / Rayfin** 1280×720 canvas. Inspired by
[jeantimex/flights-tracker](https://github.com/jeantimex/flights-tracker) — but
where that renders 34k *simulated* flights from a static file, Skyfield is wired
to render **real aircraft** streamed through the
[`fabric-live-api-backend`](../fabric-live-api-backend) (OpenSky → Eventstream →
Eventhouse) and read live via a Power BI semantic model.

```
OpenSky /states/all → fabric-live-api-backend → Eventhouse (Flights)
                                                      │
                                  Direct Lake semantic model ("flightsModel")
                                                      │  DAX (live-flights.dax)
                                                      ▼
                              Skyfield globe (this app) inside the Fabric portal
```

## What it does

- **3D Earth** with a fresnel atmosphere, graticule, and starfield (no external
  textures needed; drop an equirect map into `<Globe textureUrl>` for photoreal).
- **Aircraft as a GPU point cloud** (up to 8k), positioned by lat/lon and
  **colored by altitude** (teal → amber → magenta).
- **Click any aircraft** for live telemetry (callsign, origin, altitude, speed,
  heading, climb/descent state) with a pulsing selection marker.
- **HUD**: KPI strip (tracked / airborne / countries / avg altitude & speed),
  a "busiest airspace" bar chart, an altitude legend, and live controls.
- Fits the fixed **1280×720** Fabric canvas with zero page scroll.

## Run it (demo mode)

```bash
npm install
npm run dev      # http://localhost:5174 — runs on animated SAMPLE data
npm run build    # typecheck + production build
```

Out of the box it runs on a **sample fleet** (`src/data/sampleFlights.ts`) that
moves along headings, so the globe is alive without any backend. The control
panel shows `● DEMO · sample data`.

## Go live (Fabric data)

1. Stand up the backend and Eventhouse — see
   [`fabric-live-api-backend`](../fabric-live-api-backend) (run with
   `INGEST_SOURCE=opensky`) and `scripts/eventhouse-flights-setup.kql`.
2. Build a **Direct Lake semantic model** over the `Flights` table /
   `LatestFlights()` snapshot; add the measures in
   `scripts/semantic-model-flights.dax`.
3. `cp fabric.yaml.example fabric.yaml`, fill in your workspace + model ids,
   then `npx fabric-app-data generate -o src/fabric.generated.ts`.
4. In `src/App.tsx`, swap the `SampleFlightProvider` for
   `createFabricFlightProvider(getFabricClient(), "flightsModel")`
   (`src/data/fabric/fabricProvider.ts`) and poll `getFlights()` on an interval.
5. `cp rayfin/rayfin.yml.example rayfin/rayfin.yml`, then
   `npx rayfin login && npx rayfin up`.

> ⚠️ Like all Rayfin data apps, the deployed app only renders inside the Fabric
> portal. Use sample mode (above) for local visual iteration.

## Structure

```
src/
  three/        Globe (atmosphere shader), Aircraft (point cloud), Scene (canvas)
  data/         types + sample provider + fabric/ (semantic-model adapter, DAX)
  components/   Hud (KPIs, top countries, detail), ControlsPanel
  lib/geo.ts    lat/lon → vector3, altitude color ramp
queries/flights/live-flights.dax   the live read query (matches fabricProvider)
```

## Roadmap (next)

- Great-circle **flight-path trails** and origin→destination arcs.
- **Search / filter** by callsign, country, altitude band.
- **Time-travel playback** from Eventhouse history.
- Real-time **day/night terminator** from the sun's subsolar point.

> Fan/demo project for learning Fabric + Rayfin + react-three-fiber. Aircraft
> data © OpenSky Network contributors.
