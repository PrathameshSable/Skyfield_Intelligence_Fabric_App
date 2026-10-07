# Agent guide — skyfield-flight-intelligence

Context for AI agents (and humans) working in this repo.

## What this is

A cinematic **3D live flight-intelligence app** (React + react-three-fiber) built
for the Microsoft **Fabric / Rayfin** 1280×720 canvas. It renders aircraft on a
globe and reads live positions from a Power BI **semantic model** (`flightsModel`)
fed by the sibling `fabric-live-api-backend` (OpenSky → Eventstream → Eventhouse).

## Golden rules

- **Fixed 1280×720 canvas, zero page scroll.** Every overlay is absolutely
  positioned on `.stage`; only internal panels scroll. Don't let the page grow.
- **The data contract is `Flight`** (`src/data/types.ts`) — it mirrors the
  backend's `FlightEvent`. Both the sample provider and the Fabric provider must
  return this shape. Change it in lockstep with the backend.
- **Two data sources, one interface** (`FlightSource`, `src/data/flightSource.ts`):
  the animated `SampleFlightProvider` (standalone/dev) and `LiveFlightSource`
  (Fabric). `resolveFlightSource()` picks live when embedded in the portal.
- **Render-loop work goes through refs, not React state.** The scene reads
  `getFlights()` each frame; per-frame `setState` will tank FPS.
- **Keep the SDK read path intact.** `getFabricClient()` (`src/lib/fabric-client.ts`)
  + `fabric.generated.ts` is how live data flows. The live DAX lives in
  `src/data/fabric/flightQueries.ts` and its column order must match `rowToFlight`.

## Layout

```
src/three/      Globe, FlightArcs, Aircraft (point cloud), Scene
src/data/       types, sample provider, flightSource, filter, fabric/ (SDK read + DAX)
src/components/ Hud, ControlsPanel, SearchPanel
src/lib/        geo (lat/lon→vec3, color ramp), greatCircle
```

## Workflow

```bash
npm run dev            # standalone sample globe (http://localhost:5174)
npm run lint           # eslint
npm test               # vitest (pure-logic specs: geo, greatCircle, filter)
npm run build          # typecheck + production build
npm run build:fabric   # + fabric-app-data generate (deploy build)
```

Deploying to Fabric: see the repo-root **FABRIC_DEPLOYMENT.md**.

## When changing the data shape

Touch all of: `src/data/types.ts`, the backend `FlightEvent`, the Eventhouse
`Flights` table DDL, `LIVE_FLIGHTS_DAX`, and `rowToFlight` — or the live path
silently mis-maps columns.
