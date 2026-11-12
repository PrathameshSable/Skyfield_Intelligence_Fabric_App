import { describe, it, expect } from "vitest";
import { isRemoteAction, keyToAction, step } from "./remoteKeys.js";

describe("isRemoteAction", () => {
  it("accepts known actions and rejects everything else", () => {
    expect(isRemoteAction("nextCountry")).toBe(true);
    expect(isRemoteAction("reset")).toBe(true);
    expect(isRemoteAction("feedStart")).toBe(true);
    expect(isRemoteAction("band")).toBe(true);
    expect(isRemoteAction("startFeed")).toBe(false);
    expect(isRemoteAction("ArrowRight")).toBe(false);
    expect(isRemoteAction(42)).toBe(false);
    expect(isRemoteAction(undefined)).toBe(false);
  });
});

describe("keyToAction", () => {
  it("maps remote keys, ignoring letter case", () => {
    expect(keyToAction("ArrowRight")).toBe("nextCountry");
    expect(keyToAction("PageUp")).toBe("zoomIn");
    expect(keyToAction("-")).toBe("zoomOut");
    expect(keyToAction("T")).toBe("tour");
    expect(keyToAction(" ")).toBe("orbit");
  });
  it("ignores keys it does not own", () => {
    expect(keyToAction("x")).toBeUndefined();
    expect(keyToAction("feedStart")).toBeUndefined();
    expect(keyToAction("Tab")).toBeUndefined();
    expect(keyToAction("arrowright")).toBeUndefined();
  });
});

describe("step", () => {
  it("wraps in both directions", () => {
    expect(step(3, 2, 1)).toBe(0);
    expect(step(3, 0, -1)).toBe(2);
    expect(step(3, 1, 1)).toBe(2);
  });
  it("starts at the first or last when nothing is selected", () => {
    expect(step(3, -1, 1)).toBe(0);
    expect(step(3, -1, -1)).toBe(2);
  });
  it("returns -1 for an empty list", () => {
    expect(step(0, -1, 1)).toBe(-1);
  });
});
