# Publishing to a Fabric workspace — from scratch

End-to-end runbook to take this project from nothing to a **live flight-tracker
Rayfin app running in your Microsoft Fabric workspace**, fed by **real OpenSky
aircraft data**. It ties together the two projects in this repo:

- **`fabric-live-api-backend`** — ingests OpenSky → Fabric Eventstream/Eventhouse
- **`skyfield-flight-intelligence`** — the 3D globe Rayfin app you publish

Plan: get the app **visible in the portal first** (sample data, ~10 min), then
**build the data pipeline** and switch it to **live**.

```
OpenSky /states/all → backend → Eventstream → Eventhouse (Flights)
                                                    │ OneLake availability
                                          Direct Lake semantic model (flightsModel)
                                                    │ DAX
                                          Skyfield Rayfin app  ← you publish this
```

---

## 0. Prerequisites

| Need | Notes |
|---|---|
| **Microsoft Fabric workspace on a capacity** | A [Fabric trial](https://learn.microsoft.com/fabric/get-started/fabric-trial) works. You must be able to create items in it. |
| **Node.js 20+** | `node -v` |
| **OpenSky account** | Create an API client at *opensky-network.org → Account → API clients* for OAuth2 `client_id` / `client_secret`. |
| **Network egress** | The machine running the **backend** must reach `opensky-network.org` + `auth.opensky-network.org`. The machine running **`rayfin up`** must reach `login.microsoftonline.com` + `*.fabric.microsoft.com`. |

```bash
git clone <this-repo> && cd Skyfield_Intelligence_Fabric_App
(cd fabric-live-api-backend && npm install)
(cd skyfield-flight-intelligence && npm install)
```

---

## Milestone A — Publish the app shell (sample data) ✅ first win

Get Skyfield running in the Fabric portal before any data work, so you can
confirm the deploy path end-to-end.

```bash
cd skyfield-flight-intelligence
cp rayfin/rayfin.yml.example rayfin/rayfin.yml
```

Edit `rayfin/rayfin.yml` and set the shell build command:

```yaml
  staticHosting:
    buildCommand: npm run build:fabric:sample   # forces sample data; no model needed
```

Then sign in and deploy:

```bash
npx rayfin login                 # interactive MSAL sign-in (your browser)
npx rayfin up --workspace "<Your Workspace Name>"
```

`rayfin up` prints a **Fabric portal link** and a hosting URL. Open the portal
link — you should see the globe with the animated sample fleet, the HUD, arcs,
and search. The control panel shows `DEMO · sample data`.

> If `login` complains about the OS keychain (dev containers/Codespaces), add
> `--encryption-fallback-enabled`.

---

## Milestone B — Build the live data pipeline

### B1. Eventhouse (KQL) — the live store

1. Fabric → **Real-Time Intelligence** → **Eventhouse** → create one (e.g. `SkyfieldRT`).
2. Open its **KQL database** → query window → paste and run
   [`fabric-live-api-backend/scripts/eventhouse-flights-setup.kql`](fabric-live-api-backend/scripts/eventhouse-flights-setup.kql).
   This creates the `Flights` table, the `FlightsJson` ingestion mapping, and
   the `LatestFlights()` / `TopCountries()` helper functions.
3. On the KQL database, enable **OneLake availability** (so the semantic model
   can use Direct Lake in B4).

### B2. Eventstream — the ingress

1. Real-Time Intelligence → **Eventstream** → create one (e.g. `SkyfieldStream`).
2. **New source → Custom App** (Custom Endpoint). Open its **Keys** tab and copy
   the **Event Hubs-compatible connection string** (it ends with `EntityPath=…`).
3. **New destination → KQL Database** → point at your Eventhouse → table
   `Flights`, data format **JSON**, mapping `FlightsJson`. Publish the stream.

### B3. Run the backend — pump real aircraft in

```bash
cd ../fabric-live-api-backend
cp .env.example .env
```

Fill in `.env`:

```bash
INGEST_SOURCE=opensky
OPENSKY_CLIENT_ID=<your opensky client id>
OPENSKY_CLIENT_SECRET=<your opensky client secret>
OPENSKY_BBOX=48,2,52,8           # ~24 sq° = 1 credit/call; widen for more planes
INGEST_POLL_INTERVAL_MS=25000    # 25s ≈ 3,456 calls/day, inside the 4000 credit/day budget
EVENTSTREAM_CONNECTION_STRING=<from B2 Keys tab>
```

> **OpenSky credits:** a free account gets ~4000/day; a `/states/all` call costs
> 1–4 credits by bbox area (<25 sq°=1, 25–100=2, 100–400=3, >400/none=4). Keep
> the box small to run all day; widen it and raise the interval to compensate.

```bash
npm run dev      # polls OpenSky every ~8s → Eventstream → Eventhouse
```

Verify in the KQL database: `Flights | summarize count() by bin(ingestedAt, 1m)`
— rows should be climbing. `LatestFlights() | count` shows the live aircraft set.

> Run this anywhere with egress to OpenSky + the Eventstream (your laptop is
> fine; for always-on, host it as an Azure Container App / Function).

### B4. Semantic model — what the app queries

1. From the KQL database (with OneLake availability on), **create a semantic
   model** over the `Flights` table (Direct Lake).
2. Open the model's **DAX query view** and define the measures in
   [`fabric-live-api-backend/scripts/semantic-model-flights.dax`](fabric-live-api-backend/scripts/semantic-model-flights.dax); save them to the model.
3. Note the model's **workspaceId** and **itemId** from its URL:
   `…/groups/<workspaceId>/datasets/<itemId>/…`

---

## Milestone C — Switch the app to live data

```bash
cd ../skyfield-flight-intelligence
cp fabric.yaml.example fabric.yaml
```

Put your ids in `fabric.yaml`:

```yaml
profiles:
  default:
    semanticModels:
      flightsModel:
        workspaceId: <your workspace guid>
        itemId: <your flightsModel guid>
```

Restore the **live** build command in `rayfin/rayfin.yml`:

```yaml
  staticHosting:
    buildCommand: npm run build:fabric     # generate + build (live)
```

Generate the typed config and redeploy:

```bash
npx fabric-app-data generate -o src/fabric.generated.ts
npx rayfin up -y
```

Open the portal link. The globe now plots **real aircraft** from your Eventhouse,
KPIs/arcs/search all driven by live DAX. The control panel reads `LIVE · Fabric`.

---

## Service-principal (non-interactive) deploys — optional

To deploy from CI or a headless host instead of an interactive browser login:

1. Entra app registration → client id + secret; tenant admin enables
   **"Service principals can use Fabric APIs"**; grant the SP **Contributor** on
   the workspace.
2. ```bash
   npx rayfin login --service-principal -u <client-id> -p <client-secret> -t <tenant-id>
   npx rayfin up --workspace-id <workspace-guid> -y
   ```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| App: *"Can't open outside Fabric"* at localhost | Expected — Rayfin apps only render inside the portal. Use the `rayfin up` portal link, or `npm run dev` for the standalone sample globe. |
| Globe is empty in the portal (live mode) | No data yet, or the model can't be read. Confirm B3 is flowing (`LatestFlights() | count`), and that `fabric.yaml` ids are correct + `generate` was re-run. |
| `generate` writes nothing | You're not signed in / the model doesn't exist yet. Complete B4 and `npx rayfin login` first. |
| Backend: OpenSky 401/403 | Check OAuth client id/secret; new OpenSky accounts must use OAuth2 (basic auth is gone). |
| `rayfin login` keychain error | Re-run with `--encryption-fallback-enabled`. |
```
