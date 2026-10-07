# fabric-live-api-backend

A Node + TypeScript backend service that ingests an **external live REST API**,
streams events into a **Microsoft Fabric Eventstream → Eventhouse (KQL)**, and
exposes a small **write-back API** for a Fabric **Rayfin** data app to call.

> This is a standalone project intended to live in **its own repo**. It is
> currently scaffolded inside the `MortalKomat_Fabric_App_Rayfin` repo only so
> the work persists; everything here is self-contained and git-init-ready.

## Why this shape

Rayfin data apps render inside the Microsoft Fabric portal and read their data
through a Power BI **semantic model** (DAX) — they **can't write directly** to a
data store. So this backend is the **single write path** for both directions:

```
External REST API
      │  poll (or receive webhooks)
      ▼
┌──────────────────────────────┐        Fabric (Rayfin) app
│  fabric-live-api-backend     │◀── real-time write-back ── POST /api/events
│  • ingest + validate         │◀── durable  write-back ── POST /api/writeback
│  • batch → Eventstream       │
│  • batch → Warehouse (T-SQL) │
└──────────────────────────────┘
   │ Event Hubs endpoint           │ TDS / T-SQL (port 1433, SPN auth)
   ▼                               ▼
Fabric Eventstream            Fabric Warehouse
   │                               │   (durable, relational, updatable)
   ▼                               ▼
Eventhouse (KQL)            Direct Lake semantic model
   │                               │
   └──────────► Power BI semantic model ──DAX──► Rayfin app reads (near-real-time)
```

Two write paths, by purpose:

| Path | Target | Use for |
|---|---|---|
| `POST /api/events` | Eventstream → **Eventhouse (KQL)** | high-frequency / telemetry feeding live dashboards |
| `POST /api/writeback` | **Fabric Warehouse (T-SQL)** | durable records that must be relational / queryable / **updatable** |

Both batch their writes (Fabric flags per-row writes as an anti-pattern). The
Warehouse writer authenticates with a Microsoft Entra **service principal** over
TDS and **retries on write-write conflicts** (first commit wins in Fabric).

## Live flight mode (OpenSky) — default

Set `INGEST_SOURCE=opensky` (the default) to ingest **real aircraft** from the
[OpenSky Network](https://openskynetwork.github.io/opensky-api/rest.html)
`/states/all` endpoint. Create an API client at *opensky-network.org → Account →
API clients* for OAuth2 `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`, and
optionally set `OPENSKY_BBOX` to limit the region. Each aircraft becomes a
`FlightEvent` (`src/flights/flightTypes.ts`) flowing to the Eventstream →
Eventhouse `Flights` table. Set `INGEST_SOURCE=generic` for the original metric
API instead.

> Network: the host running this backend must be allowed to reach
> `opensky-network.org` and `auth.opensky-network.org`.

## Project layout

```
src/
  config.ts                  env loading + validation (fail-fast)
  logger.ts                  pino logger
  types.ts                   StreamEvent + LiveEvent models
  flights/
    flightTypes.ts           OpenSky state-vector parser → FlightEvent (Zod)
    openSkyAuth.ts           OAuth2 client-credentials token provider
    openSkySource.ts         /states/all ingest source
  ingest/
    source.ts                IngestSource interface + generic source
    apiClient.ts             external REST client (retry + backoff + validation)
    poller.ts                source-agnostic poll loop → Eventstream
  stream/
    eventstreamProducer.ts   batched Event Hubs producer (Eventstream custom app)
  kql/
    eventhouseClient.ts      optional KQL read client (service-principal auth)
  warehouse/
    warehouseWriter.ts       Fabric Warehouse T-SQL writer (SPN auth, batched INSERT, conflict retry)
  api/
    server.ts                Express API: /api/events, /api/writeback, /api/events/recent, /webhooks/ingest, /healthz
  index.ts                   wires it all together + graceful shutdown
scripts/
  eventhouse-setup.kql       KQL table + JSON ingestion mapping (run in Fabric)
  warehouse-setup.sql        Warehouse table DDL + MERGE-upsert notes (run in Fabric)
tests/
  transform.test.ts          vitest unit tests for the transform layer
```

## Prerequisites in Fabric (one-time)

1. **Eventhouse + KQL DB** — Real-Time Intelligence → create an Eventhouse.
   Run [`scripts/eventhouse-setup.kql`](scripts/eventhouse-setup.kql) to create
   the `LiveEvents` table and JSON ingestion mapping.
2. **Eventstream** with a **Custom App source** and a **KQL Database destination**
   pointing at that table. Copy the custom-app **connection string** (Keys tab) —
   it's Event Hubs-compatible and carries `EntityPath=…`.
3. **Fabric Warehouse** *(for durable write-back)* — create a Warehouse and run
   [`scripts/warehouse-setup.sql`](scripts/warehouse-setup.sql) to create the
   `dbo.LiveEvents` table. Grab its **SQL connection string** host.
4. **Microsoft Entra app registration (service principal)** — used by both the
   Warehouse writer and the optional KQL read client. Required setup:
   - tenant admin enables **"Service principals can use Fabric APIs"**;
   - grant the SPN a **workspace role (Contributor)** or item permission on the
     Warehouse / KQL DB;
   - ⚠️ a brand-new SPN must make **one Fabric REST API call to bootstrap its
     token** before `COPY INTO`/external-storage commands work (plain
     `INSERT`/`MERGE` over TDS is fine without it).
5. Point a **Power BI semantic model** at the KQL DB and/or Warehouse (Direct
   Lake) and have your Rayfin app query it via DAX (the read path — unchanged
   from the MK Arena app pattern).

## Run it

```bash
npm install
cp .env.example .env     # fill in EVENTSTREAM_CONNECTION_STRING + external API details
npm run dev              # poller + API with hot reload
# or
npm run build && npm start
```

Useful scripts: `npm run typecheck`, `npm run lint`, `npm test`.

## Configuration

All config is environment-driven and validated at startup — see
[`.env.example`](.env.example) for the full annotated list. Key ones:

| Variable | Purpose |
|---|---|
| `EXTERNAL_API_BASE_URL` / `EXTERNAL_API_PATH` / `EXTERNAL_API_KEY` | the live REST API you ingest |
| `INGEST_POLL_INTERVAL_MS` / `INGEST_POLL_ENABLED` | poll cadence (disable if webhook-only) |
| `EVENTSTREAM_CONNECTION_STRING` | Fabric Eventstream custom-app endpoint |
| `EVENTSTREAM_BATCH_MAX_SIZE` / `_MAX_WAIT_MS` | batching behavior |
| `KUSTO_*` + `AZURE_*` | optional KQL read API (service principal) |
| `CORS_ALLOWED_ORIGINS` | Fabric portal origin(s) allowed to call write-back |

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | liveness + whether KQL / Warehouse are configured |
| `POST` | `/api/events` | **real-time write-back** (validated → Eventstream → Eventhouse) |
| `POST` | `/api/writeback` | **durable write-back** (validated → Fabric Warehouse via T-SQL) |
| `GET` | `/api/events/recent?limit=50` | recent rows from the Eventhouse (debug/read) |
| `POST` | `/webhooks/ingest` | receive pushes from the external API (verify signatures before prod) |

## Adapt before production

- **`src/types.ts`** — `ExternalRecordSchema` is an example "metric reading".
  Replace its fields with your real API payload; the rest of the pipeline keys
  off the normalized `LiveEvent`.
- **Webhook auth** — `/webhooks/ingest` is unauthenticated in the scaffold. Add
  signature verification / a shared secret before exposing it.
- **App write-back auth** — consider validating the Fabric user's token on
  `/api/events` rather than relying on CORS alone.
- **Secrets** — never commit `.env`. In Azure, prefer Managed Identity /
  Key Vault over inline client secrets.

## Splitting into its own repo

```bash
# from this folder:
git init && git add . && git commit -m "Initial scaffold"
# create an empty GitHub repo, then:
git remote add origin git@github.com:<you>/fabric-live-api-backend.git
git push -u origin main
```
