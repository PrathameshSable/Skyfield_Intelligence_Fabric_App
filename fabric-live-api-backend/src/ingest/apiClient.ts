import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExternalRecordSchema, type ExternalRecord } from "../types.js";

/**
 * Thin client for the external live REST API, with bounded retry + exponential
 * backoff. Returns validated records; invalid items are dropped (and logged)
 * rather than crashing the poller.
 */
export class ExternalApiClient {
  private readonly url: string;

  constructor() {
    this.url = new URL(config.EXTERNAL_API_PATH, config.EXTERNAL_API_BASE_URL).toString();
  }

  async fetchRecords(signal?: AbortSignal): Promise<ExternalRecord[]> {
    const raw = await this.fetchWithRetry(signal);
    // Accept either a bare array or a { data: [...] } envelope — adapt as needed.
    const items: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { data?: unknown[] })?.data)
        ? (raw as { data: unknown[] }).data
        : [raw];

    const valid: ExternalRecord[] = [];
    for (const item of items) {
      const parsed = ExternalRecordSchema.safeParse(item);
      if (parsed.success) {
        valid.push(parsed.data);
      } else {
        logger.warn({ issues: parsed.error.issues }, "dropping invalid external record");
      }
    }
    return valid;
  }

  private async fetchWithRetry(signal?: AbortSignal, maxAttempts = 4): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(this.url, {
          headers: {
            Accept: "application/json",
            ...(config.EXTERNAL_API_KEY
              ? { Authorization: `Bearer ${config.EXTERNAL_API_KEY}` }
              : {}),
          },
          signal,
        });
        if (!res.ok) {
          throw new Error(`external API responded ${res.status} ${res.statusText}`);
        }
        return await res.json();
      } catch (err) {
        if (signal?.aborted) throw err;
        lastErr = err;
        const backoffMs = 2 ** (attempt - 1) * 250;
        logger.warn(
          { attempt, maxAttempts, backoffMs, err: (err as Error).message },
          "external API fetch failed; retrying",
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
