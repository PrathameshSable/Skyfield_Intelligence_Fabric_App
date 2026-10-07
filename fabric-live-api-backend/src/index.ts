import { config } from "./config.js";
import { logger } from "./logger.js";
import { EventstreamProducer } from "./stream/eventstreamProducer.js";
import { EventhouseClient } from "./kql/eventhouseClient.js";
import { WarehouseWriter } from "./warehouse/warehouseWriter.js";
import { IngestPoller } from "./ingest/poller.js";
import { GenericApiSource, type IngestSource } from "./ingest/source.js";
import { OpenSkySource } from "./flights/openSkySource.js";
import { createServer } from "./api/server.js";

function selectSource(): IngestSource {
  switch (config.INGEST_SOURCE) {
    case "opensky":
      return new OpenSkySource();
    case "generic":
      return new GenericApiSource();
  }
}

/**
 * Entry point. Wires together:
 *   live source (OpenSky flights)  ──poll──▶  Eventstream  ──▶  Eventhouse
 *   Fabric app  ──write-back──▶  Eventstream / Warehouse
 */
async function main(): Promise<void> {
  const producer = new EventstreamProducer();
  const eventhouse = new EventhouseClient();
  const warehouse = new WarehouseWriter();
  const poller = new IngestPoller(selectSource(), producer);

  const app = createServer({ producer, eventhouse, warehouse });
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, "API listening");
  });

  poller.start();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    poller.stop();
    server.close();
    try {
      await producer.close();
      await warehouse.close();
      await eventhouse.close();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "error during shutdown");
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err: (err as Error).message }, "fatal startup error");
  process.exit(1);
});
