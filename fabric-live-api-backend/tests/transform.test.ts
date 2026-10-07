import { describe, it, expect } from "vitest";
import {
  ExternalRecordSchema,
  WriteBackSchema,
  toLiveEvent,
  writeBackToLiveEvent,
} from "../src/types.js";

describe("ExternalRecordSchema", () => {
  it("accepts a valid record and coerces id to string", () => {
    const parsed = ExternalRecordSchema.parse({
      id: 42,
      metric: "temperature",
      value: 21.5,
      unit: "C",
    });
    expect(parsed.id).toBe("42");
    expect(parsed.source).toBe("external-api");
  });

  it("rejects a record missing required fields", () => {
    const result = ExternalRecordSchema.safeParse({ id: 1 });
    expect(result.success).toBe(false);
  });
});

describe("toLiveEvent", () => {
  it("normalizes a record and fills timestamps", () => {
    const event = toLiveEvent({
      id: "abc",
      source: "external-api",
      metric: "humidity",
      value: 55,
    });
    expect(event.kind).toBe("reading");
    expect(event.metric).toBe("humidity");
    expect(event.value).toBe(55);
    expect(event.unit).toBeNull();
    expect(() => new Date(event.eventTime).toISOString()).not.toThrow();
    expect(() => new Date(event.ingestedAt).toISOString()).not.toThrow();
  });

  it("preserves an upstream timestamp when present", () => {
    const ts = "2026-06-11T10:00:00.000Z";
    const event = toLiveEvent({
      id: "x",
      source: "external-api",
      metric: "m",
      value: 1,
      timestamp: ts,
    });
    expect(event.eventTime).toBe(ts);
  });
});

describe("write-back", () => {
  it("generates an id when none is supplied", () => {
    const input = WriteBackSchema.parse({ kind: "app.annotation", payload: { note: "hi" } });
    const event = writeBackToLiveEvent(input);
    expect(event.source).toBe("app");
    expect(event.kind).toBe("app.annotation");
    expect(event.id).toMatch(/[0-9a-f-]{36}/);
    expect(event.payload).toEqual({ note: "hi" });
  });

  it("honors a caller-supplied id", () => {
    const input = WriteBackSchema.parse({ kind: "k", id: "fixed-id" });
    expect(writeBackToLiveEvent(input).id).toBe("fixed-id");
  });
});
