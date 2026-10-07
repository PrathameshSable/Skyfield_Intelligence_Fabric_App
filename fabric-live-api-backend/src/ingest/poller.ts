import { config } from "../config.js";
import { logger } from "../logger.js";
import type { EventstreamProducer } from "../stream/eventstreamProducer.js";
import type { IngestSource } from "./source.js";

/**
 * Periodically pulls from an {@link IngestSource} and forwards normalized events
 * to the Eventstream producer. One poll never overlaps the next, so a slow
 * upstream can't pile up concurrent requests.
 */
export class IngestPoller {
  private readonly abort = new AbortController();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly source: IngestSource,
    private readonly producer: EventstreamProducer,
  ) {}

  start(): void {
    if (!config.INGEST_POLL_ENABLED) {
      logger.info("ingest poller disabled (INGEST_POLL_ENABLED=false)");
      return;
    }
    logger.info(
      { source: this.source.name, intervalMs: config.INGEST_POLL_INTERVAL_MS },
      "starting ingest poller",
    );
    this.scheduleNext(0);
  }

  private scheduleNext(delayMs: number): void {
    if (this.abort.signal.aborted) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const events = await this.source.fetchEvents(this.abort.signal);
      if (events.length > 0) {
        this.producer.enqueueMany(events);
        logger.debug(
          { source: this.source.name, count: events.length },
          "ingested events",
        );
      }
    } catch (err) {
      if (!this.abort.signal.aborted) {
        logger.error({ err: (err as Error).message }, "ingest tick failed");
      }
    } finally {
      this.running = false;
      this.scheduleNext(config.INGEST_POLL_INTERVAL_MS);
    }
  }

  stop(): void {
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    logger.info("ingest poller stopped");
  }
}
