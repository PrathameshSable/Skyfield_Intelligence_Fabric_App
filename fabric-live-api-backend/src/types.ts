import { z } from "zod";

/**
 * ⚠️ ADAPT THIS to your real external API.
 *
 * `ExternalRecordSchema` is the shape the external REST API returns for a single
 * record. The example models a generic "metric reading" — swap the fields for
 * whatever your API actually sends. Validating here means a malformed upstream
 * payload is rejected at the edge instead of poisoning the Eventhouse.
 */
export const ExternalRecordSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  source: z.string().default("external-api"),
  metric: z.string(),
  value: z.number(),
  unit: z.string().optional(),
  // Upstream timestamp; we fall back to ingestion time if absent.
  timestamp: z.string().datetime().optional(),
});

export type ExternalRecord = z.infer<typeof ExternalRecordSchema>;

/**
 * The normalized event we actually write to the Eventstream / Eventhouse.
 * Keep this stable — your KQL table schema and the Fabric semantic model are
 * built on it.
 */
/**
 * Base shape for anything published to the Eventstream. Using a type alias
 * (not an interface) keeps it assignable to `Record<string, unknown>`, so the
 * producer can carry both `LiveEvent` (generic metrics) and `FlightEvent`.
 */
export type StreamEvent = Record<string, unknown>;

export type LiveEvent = {
  /** Stable id of the underlying record. */
  id: string;
  /** Where it came from: the external API, or "app" for write-back. */
  source: string;
  /** Logical event kind, e.g. "reading" or "app.annotation". */
  kind: string;
  /** Metric / field name being reported. */
  metric: string;
  /** Numeric value (null for non-numeric events). */
  value: number | null;
  unit: string | null;
  /** Event time (ISO 8601, UTC). */
  eventTime: string;
  /** When this service ingested it (ISO 8601, UTC). */
  ingestedAt: string;
  /** Free-form passthrough for anything extra. */
  payload: Record<string, unknown>;
};

/** Map a validated external record into our normalized LiveEvent. */
export function toLiveEvent(record: ExternalRecord): LiveEvent {
  const now = new Date().toISOString();
  return {
    id: record.id,
    source: record.source,
    kind: "reading",
    metric: record.metric,
    value: record.value,
    unit: record.unit ?? null,
    eventTime: record.timestamp ?? now,
    ingestedAt: now,
    payload: {},
  };
}

/**
 * Write-back events coming FROM the Fabric app (user actions, annotations…).
 * These flow app → this backend → Eventstream/Eventhouse, since Rayfin data
 * apps read via DAX but cannot write directly.
 */
export const WriteBackSchema = z.object({
  kind: z.string().min(1).max(128),
  metric: z.string().min(1).max(256).default("app.event"),
  value: z.number().nullable().default(null),
  unit: z.string().max(64).optional(),
  /** Optional caller-supplied id; we generate one if omitted. */
  id: z.string().max(256).optional(),
  payload: z.record(z.unknown()).default({}),
});

export type WriteBackInput = z.infer<typeof WriteBackSchema>;

export function writeBackToLiveEvent(input: WriteBackInput): LiveEvent {
  const now = new Date().toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    source: "app",
    kind: input.kind,
    metric: input.metric,
    value: input.value,
    unit: input.unit ?? null,
    eventTime: now,
    ingestedAt: now,
    payload: input.payload,
  };
}
