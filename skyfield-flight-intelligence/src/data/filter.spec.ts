import { describe, it, expect } from "vitest";
import { matchesFilter, isFilterActive, EMPTY_FILTER } from "./filter.js";
import type { Flight } from "./types.js";

const base: Flight = {
  icao24: "abc123",
  callsign: "SWR123",
  originCountry: "Switzerland",
  longitude: 8,
  latitude: 47,
  geoAltitude: 11000, // ~36,089 ft → "high"
  velocity: 240,
  heading: 90,
  verticalRate: 0,
  onGround: false,
  originLat: 51.47,
  originLon: -0.46,
  destLat: 40.64,
  destLon: -73.78,
  originIata: "LHR",
  destIata: "JFK",
  airline: "British Airways",
  manufacturer: "Airbus",
  aircraftType: "Airbus A320neo",
};

describe("isFilterActive", () => {
  it("is false for the empty filter", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });
  it("is true once any facet is set", () => {
    expect(isFilterActive({ ...EMPTY_FILTER, text: "swr" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, band: "high" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, airborneOnly: true })).toBe(true);
  });
});

describe("matchesFilter", () => {
  it("matches text against callsign, country, and icao24 (case-insensitive)", () => {
    expect(matchesFilter(base, { ...EMPTY_FILTER, text: "swr" })).toBe(true);
    expect(matchesFilter(base, { ...EMPTY_FILTER, text: "switz" })).toBe(true);
    expect(matchesFilter(base, { ...EMPTY_FILTER, text: "ABC1" })).toBe(true);
    expect(matchesFilter(base, { ...EMPTY_FILTER, text: "ryanair" })).toBe(false);
  });

  it("filters by altitude band", () => {
    expect(matchesFilter(base, { ...EMPTY_FILTER, band: "high" })).toBe(true);
    expect(matchesFilter(base, { ...EMPTY_FILTER, band: "low" })).toBe(false);
    const low = { ...base, geoAltitude: 1500 };
    expect(matchesFilter(low, { ...EMPTY_FILTER, band: "low" })).toBe(true);
  });

  it("respects airborne-only", () => {
    const grounded = { ...base, onGround: true };
    expect(matchesFilter(grounded, { ...EMPTY_FILTER, airborneOnly: true })).toBe(false);
    expect(matchesFilter(base, { ...EMPTY_FILTER, airborneOnly: true })).toBe(true);
  });
});
