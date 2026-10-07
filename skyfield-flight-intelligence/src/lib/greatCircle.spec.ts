import { describe, it, expect } from "vitest";
import { destinationPoint, forwardArc } from "./greatCircle.js";

describe("destinationPoint", () => {
  it("heading north increases latitude", () => {
    const d = destinationPoint(0, 0, 0, 10);
    expect(d.lat).toBeCloseTo(10, 4);
    expect(d.lon).toBeCloseTo(0, 4);
  });

  it("heading east near the equator increases longitude", () => {
    const d = destinationPoint(0, 0, 90, 10);
    expect(d.lon).toBeGreaterThan(0);
    expect(Math.abs(d.lat)).toBeLessThan(1e-6);
  });

  it("wraps longitude into [-180, 180]", () => {
    const d = destinationPoint(0, 175, 90, 20);
    expect(d.lon).toBeGreaterThanOrEqual(-180);
    expect(d.lon).toBeLessThanOrEqual(180);
  });
});

describe("forwardArc", () => {
  it("returns steps+1 points starting at the surface radius", () => {
    const pts = forwardArc(45, 10, 90, 2, { steps: 12, lift: 0 });
    expect(pts).toHaveLength(13);
    expect(pts[0]!.length()).toBeCloseTo(2, 4);
  });

  it("lifts the middle of the arc above the base radius", () => {
    const pts = forwardArc(0, 0, 90, 2, { steps: 10, lift: 0.1 });
    const mid = pts[5]!.length();
    expect(mid).toBeGreaterThan(2);
  });
});
