import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import { pinoHttp } from "pino-http";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { WriteBackSchema, writeBackToLiveEvent } from "../types.js";
import type { EventstreamProducer } from "../stream/eventstreamProducer.js";
import type { EventhouseClient } from "../kql/eventhouseClient.js";
import type { WarehouseWriter } from "../warehouse/warehouseWriter.js";

interface ServerDeps {
  producer: EventstreamProducer;
  eventhouse: EventhouseClient;
  warehouse: WarehouseWriter;
}

/**
 * Builds the app-facing HTTP API. This is what the Fabric (Rayfin) app calls
 * for write-back, since Rayfin apps read via DAX but can't write directly.
 */
export function createServer({ producer, eventhouse, warehouse }: ServerDeps): Express {
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: "256kb" }));

  // CORS — the Fabric portal is the app's origin. Reject anything not allow-listed.
  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      // Allow same-origin / server-to-server (no Origin header) and allow-listed origins.
      if (!origin || config.CORS_ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`origin not allowed: ${origin}`));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
  };
  app.use(cors(corsOptions));

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      kustoEnabled: eventhouse.enabled,
      warehouseEnabled: warehouse.enabled,
      uptime: process.uptime(),
    });
  });

  // ── Real-time write-back: Fabric app → backend → Eventstream → Eventhouse ────
  //    Use for high-frequency / telemetry-style events feeding live dashboards.
  app.post("/api/events", (req: Request, res: Response) => {
    const parsed = WriteBackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload", issues: parsed.error.issues });
      return;
    }
    const event = writeBackToLiveEvent(parsed.data);
    producer.enqueue(event);
    res.status(202).json({ accepted: true, id: event.id, target: "eventstream" });
  });

  // ── Durable write-back: Fabric app → backend → Fabric Warehouse (T-SQL) ──────
  //    Use for records that must be relational / queryable / updatable.
  app.post("/api/writeback", (req: Request, res: Response) => {
    if (!warehouse.enabled) {
      res.status(503).json({ error: "Fabric Warehouse not configured" });
      return;
    }
    const parsed = WriteBackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload", issues: parsed.error.issues });
      return;
    }
    const event = writeBackToLiveEvent(parsed.data);
    warehouse.enqueue(event);
    res.status(202).json({ accepted: true, id: event.id, target: "warehouse" });
  });

  // ── Optional read API (debug / non-Fabric clients) ──────────────────────────
  app.get("/api/events/recent", async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!eventhouse.enabled) {
        res.status(503).json({ error: "Eventhouse/KQL not configured" });
        return;
      }
      const limit = Number.parseInt(String(req.query.limit ?? "50"), 10) || 50;
      const rows = await eventhouse.recentEvents(limit);
      res.json({ count: rows.length, rows });
    } catch (err) {
      next(err);
    }
  });

  // ── Webhook ingest (if your external API pushes instead of being polled) ─────
  app.post("/webhooks/ingest", (req: Request, res: Response) => {
    // Accept the same write-back contract; real webhooks should be signature-verified.
    const parsed = WriteBackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid payload", issues: parsed.error.issues });
      return;
    }
    const event = writeBackToLiveEvent({ ...parsed.data });
    event.source = "external-api";
    producer.enqueue(event);
    res.status(202).json({ accepted: true });
  });

  // ── Error handler ───────────────────────────────────────────────────────────
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message }, "request failed");
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
