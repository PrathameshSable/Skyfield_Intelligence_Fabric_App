import { describe, it, expect } from "vitest";
import { deadReckon } from "./flightSource.js";
import type { Flight } from "./types.js";

const at = (latitude: number, heading: number, extra: Partial<Flight> = {}) =>
  ({ latitude, longitude: 10, heading, velocity: 111.32, onGround: false, ...extra }) as Flight;

describe("deadReckon", () => {
  it("moves a plane at its real speed, not an exaggerated one", () => {
    const f = at(0, 0); // due north at 111.32 m/s = 0.001 degrees of latitude per second
    deadReckon([f], 10);
    expect(f.latitude).toBeCloseTo(0.01, 6);
    expect(f.longitude).toBeCloseTo(10, 6);
  });
  it("widens the longitude step away from the equator", () => {
    const f = at(60, 90); // due east at 60N, where a degree of longitude is half as long
    deadReckon([f], 10);
    expect(f.longitude - 10).toBeCloseTo(0.02, 4);
    expect(f.latitude).toBeCloseTo(60, 6);
  });
  it("leaves grounded planes where they are", () => {
    const f = at(0, 0, { onGround: true });
    deadReckon([f], 10);
    expect(f.latitude).toBe(0);
  });
});
