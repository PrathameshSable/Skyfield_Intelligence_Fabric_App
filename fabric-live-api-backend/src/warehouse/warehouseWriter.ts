import sql from "mssql";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { LiveEvent } from "../types.js";

/**
 * Durable, relational write-back to a **Fabric Warehouse** over T-SQL (TDS).
 *
 * Design notes (all grounded in Fabric Warehouse guidance):
 *  • Auth is a Microsoft Entra **service principal** — supported natively for
 *    Warehouse SQL connections (tenant setting "Service principals can use
 *    Fabric APIs" must be on, and the SPN needs a workspace role / item grant).
 *  • Writes are **batched multi-row INSERTs**, never singleton INSERTs, which
 *    Fabric explicitly flags as a performance anti-pattern.
 *  • Write-write conflicts roll back the loser (first commit wins), so flushes
 *    **retry with exponential backoff**.
 *
 * The writer buffers events and flushes on size or time, mirroring the
 * Eventstream producer, so a burst of app write-backs collapses into few INSERTs.
 */
export class WarehouseWriter {
  private pool: sql.ConnectionPool | null = null;
  private connecting: Promise<sql.ConnectionPool> | null = null;
  private buffer: LiveEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  get enabled(): boolean {
    return config.warehouseEnabled;
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (this.connecting) return this.connecting;

    const poolConfig: sql.config = {
      server: config.FABRIC_WAREHOUSE_SERVER as string,
      database: config.FABRIC_WAREHOUSE_DATABASE as string,
      port: 1433,
      options: { encrypt: true, trustServerCertificate: false },
      authentication: {
        type: "azure-active-directory-service-principal-secret",
        options: {
          clientId: config.AZURE_CLIENT_ID as string,
          clientSecret: config.AZURE_CLIENT_SECRET as string,
          tenantId: config.AZURE_TENANT_ID as string,
        },
      },
    };

    this.connecting = new sql.ConnectionPool(poolConfig)
      .connect()
      .then((pool) => {
        this.pool = pool;
        this.connecting = null;
        logger.info("connected to Fabric Warehouse");
        return pool;
      })
      .catch((err) => {
        this.connecting = null;
        throw err;
      });
    return this.connecting;
  }

  /** Queue an event for durable write-back; auto-flushes when the batch fills. */
  enqueue(event: LiveEvent): void {
    if (!this.enabled) throw new Error("Fabric Warehouse is not configured");
    if (this.closed) throw new Error("writer is closed");
    this.buffer.push(event);
    if (this.buffer.length >= config.WAREHOUSE_BATCH_MAX_SIZE) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, config.WAREHOUSE_BATCH_MAX_WAIT_MS);
  }

  /** Write everything buffered as a single multi-row INSERT, with retry. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;

    const rows = this.buffer;
    this.buffer = [];

    try {
      await this.insertBatchWithRetry(rows);
      logger.debug({ count: rows.length }, "wrote batch to Fabric Warehouse");
    } catch (err) {
      // Requeue so durable write-back isn't lost on a transient failure.
      this.buffer.unshift(...rows);
      logger.error({ err: (err as Error).message }, "Warehouse flush failed; requeued");
      throw err;
    }
  }

  private async insertBatchWithRetry(rows: LiveEvent[], maxAttempts = 4): Promise<void> {
    const table = config.FABRIC_WAREHOUSE_TABLE;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const pool = await this.getPool();
        const request = pool.request();

        // Build a parameterized multi-row INSERT: VALUES (@id0,...),(@id1,...)
        const valueClauses = rows.map((event, i) => {
          request.input(`id${i}`, sql.VarChar(256), event.id);
          request.input(`source${i}`, sql.VarChar(64), event.source);
          request.input(`kind${i}`, sql.VarChar(128), event.kind);
          request.input(`metric${i}`, sql.VarChar(256), event.metric);
          request.input(`value${i}`, sql.Float, event.value);
          request.input(`unit${i}`, sql.VarChar(64), event.unit);
          request.input(`eventTime${i}`, sql.DateTime2, new Date(event.eventTime));
          request.input(`ingestedAt${i}`, sql.DateTime2, new Date(event.ingestedAt));
          request.input(`payload${i}`, sql.VarChar(8000), JSON.stringify(event.payload));
          return (
            `(@id${i}, @source${i}, @kind${i}, @metric${i}, @value${i}, ` +
            `@unit${i}, @eventTime${i}, @ingestedAt${i}, @payload${i})`
          );
        });

        const text =
          `INSERT INTO ${table} ` +
          `(id, source, kind, metric, value, unit, eventTime, ingestedAt, payload) ` +
          `VALUES ${valueClauses.join(", ")}`;

        await request.query(text);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === maxAttempts) break;
        const backoffMs = 2 ** (attempt - 1) * 250;
        logger.warn(
          { attempt, maxAttempts, backoffMs, err: (err as Error).message },
          "Warehouse insert failed (possible write-write conflict); retrying",
        );
        await delay(backoffMs);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      if (this.enabled) await this.flush();
    } finally {
      await this.pool?.close();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
