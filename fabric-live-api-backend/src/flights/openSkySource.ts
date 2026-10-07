import { config } from "../config.js";
import { logger } from "../logger.js";
import type { StreamEvent } from "../types.js";
import type { IngestSource } from "../ingest/source.js";
import { OpenSkyTokenProvider } from "./openSkyAuth.js";
import { parseStatesResponse } from "./flightTypes.js";

/**
 * Live flight source backed by OpenSky `/states/all`. Returns one normalized
 * FlightEvent per aircraft. An optional bounding box (lamin,lomin,lamax,lomax)
 * narrows the query — recommended, since the global feed is large.
 */
export class OpenSkySource implements IngestSource {
  readonly name = "opensky";
  private readonly auth = new OpenSkyTokenProvider();

  async fetchEvents(signal?: AbortSignal): Promise<StreamEvent[]> {
    const raw = await this.fetchWithRetry(signal);
    const flights = parseStatesResponse(raw);
    logger.debug({ count: flights.length }, "parsed OpenSky state vectors");
    return flights;
  }

  private buildUrl(): string {
    const url = new URL("/api/states/all", config.OPENSKY_API_BASE);
    if (config.OPENSKY_BBOX) {
      const [lamin, lomin, lamax, lomax] = config.OPENSKY_BBOX.split(",");
      url.searchParams.set("lamin", lamin ?? "");
      url.searchParams.set("lomin", lomin ?? "");
      url.searchParams.set("lamax", lamax ?? "");
      url.searchParams.set("lomax", lomax ?? "");
    }
    return url.toString();
  }

  private async fetchWithRetry(signal?: AbortSignal, maxAttempts = 3): Promise<unknown> {
    const url = this.buildUrl();
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const token = await this.auth.getToken(signal);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal,
        });
        if (!res.ok) {
          throw new Error(`OpenSky states request failed: ${res.status} ${res.statusText}`);
        }
        return await res.json();
      } catch (err) {
        if (signal?.aborted) throw err;
        lastErr = err;
        const backoffMs = 2 ** (attempt - 1) * 500;
        logger.warn(
          { attempt, maxAttempts, backoffMs, err: (err as Error).message },
          "OpenSky fetch failed; retrying",
        );
        await delay(backoffMs, signal);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
