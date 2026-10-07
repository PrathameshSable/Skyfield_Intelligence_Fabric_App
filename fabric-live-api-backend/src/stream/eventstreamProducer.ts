import { EventHubProducerClient, type EventData } from "@azure/event-hubs";
import { config } from "../config.js";
import { logger } from "../logger.js";
import type { StreamEvent } from "../types.js";

/**
 * Publishes normalized LiveEvents to a Fabric Eventstream via its custom-app
 * source, which exposes an Event Hubs-compatible endpoint (the connection
 * string from the Eventstream → custom app → Keys tab carries `EntityPath=`,
 * so no hub name is required here).
 *
 * Events are buffered and flushed either when the buffer fills or after a max
 * wait — Fabric explicitly recommends batched writes over per-row sends.
 */
export class EventstreamProducer {
  private readonly client: EventHubProducerClient;
  private buffer: StreamEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor() {
    this.client = new EventHubProducerClient(config.EVENTSTREAM_CONNECTION_STRING);
  }

  /** Queue an event for delivery; flushes automatically when the batch is full. */
  enqueue(event: StreamEvent): void {
    if (this.closed) throw new Error("producer is closed");
    this.buffer.push(event);
    if (this.buffer.length >= config.EVENTSTREAM_BATCH_MAX_SIZE) {
      void this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  enqueueMany(events: StreamEvent[]): void {
    for (const e of events) this.enqueue(e);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, config.EVENTSTREAM_BATCH_MAX_WAIT_MS);
  }

  /** Send everything currently buffered. Safe to call concurrently. */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;

    const toSend = this.buffer;
    this.buffer = [];

    try {
      const batch = await this.client.createBatch();
      const overflow: StreamEvent[] = [];
      for (const event of toSend) {
        const data: EventData = { body: event };
        if (!batch.tryAdd(data)) {
          overflow.push(event);
        }
      }
      await this.client.sendBatch(batch);
      logger.debug({ count: batch.count }, "flushed events to Eventstream");

      // Anything that didn't fit this batch goes back to the front of the queue.
      if (overflow.length > 0) {
        this.buffer.unshift(...overflow);
        await this.flush();
      }
    } catch (err) {
      // On failure, requeue so the data isn't silently lost.
      this.buffer.unshift(...toSend);
      logger.error({ err: (err as Error).message }, "Eventstream flush failed; requeued");
      throw err;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.flush();
    } finally {
      await this.client.close();
    }
  }
}
