import type { StreamEvent } from "../types.js";
import { toLiveEvent } from "../types.js";
import { ExternalApiClient } from "./apiClient.js";

/**
 * An ingestion source pulls from some external live API and returns normalized
 * events ready for the Eventstream. The poller is source-agnostic — swap the
 * implementation (generic metric API, OpenSky flights, …) without touching it.
 */
export interface IngestSource {
  readonly name: string;
  fetchEvents(signal?: AbortSignal): Promise<StreamEvent[]>;
}

/** Generic source: the example "metric reading" REST API. */
export class GenericApiSource implements IngestSource {
  readonly name = "generic-api";
  private readonly api = new ExternalApiClient();

  async fetchEvents(signal?: AbortSignal): Promise<StreamEvent[]> {
    const records = await this.api.fetchRecords(signal);
    return records.map(toLiveEvent);
  }
}
