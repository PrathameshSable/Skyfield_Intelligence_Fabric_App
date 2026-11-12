import { describe, expect, it } from "vitest";
import { toUtcMs } from "./fabricProvider";

describe("toUtcMs", () => {
  const utc = Date.UTC(2026, 10, 11, 16, 26, 57, 913);
  it("reads a zoneless model datetime as UTC", () => expect(toUtcMs("2026-11-11T16:26:57.913")).toBe(utc));
  it("keeps an explicit zone", () => expect(toUtcMs("2026-11-11T21:56:57.913+05:30")).toBe(utc));
  it("passes Date and epoch numbers through", () => {
    expect(toUtcMs(new Date(utc))).toBe(utc);
    expect(toUtcMs(utc)).toBe(utc);
  });
  it("returns null for junk", () => expect(toUtcMs("nope")).toBeNull());
});
