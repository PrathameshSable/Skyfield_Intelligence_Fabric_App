import { describe, it, expect } from "vitest";
import { latLonToVector3, altitudeColor } from "./geo.js";

describe("latLonToVector3", () => {
  it("places (0,0) on the +/- axis at the given radius", () => {
    const v = latLonToVector3(0, 0, 2);
    expect(v.length()).toBeCloseTo(2, 5);
  });

  it("puts the north pole at +Y", () => {
    const v = latLonToVector3(90, 0, 2);
    expect(v.y).toBeCloseTo(2, 5);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  it("keeps every point on the sphere of the given radius", () => {
    for (const [lat, lon] of [[45, 90], [-30, -120], [10, 200]] as const) {
      expect(latLonToVector3(lat, lon, 5).length()).toBeCloseTo(5, 4);
    }
  });
});

describe("altitudeColor", () => {
  it("returns an RGB triple in [0,1]", () => {
    const c = altitudeColor(8000);
    expect(c).toHaveLength(3);
    for (const ch of c) expect(ch).toBeGreaterThanOrEqual(0);
    for (const ch of c) expect(ch).toBeLessThanOrEqual(1);
  });

  it("treats null altitude as ground level without throwing", () => {
    expect(() => altitudeColor(null)).not.toThrow();
  });
});
