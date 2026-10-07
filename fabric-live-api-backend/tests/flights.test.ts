import { describe, it, expect } from "vitest";
import { parseStateVector, parseStatesResponse } from "../src/flights/flightTypes.js";

// A representative OpenSky state vector (positional array).
const sample = [
  "4b1814", // icao24
  "SWR123  ", // callsign (padded — should be trimmed)
  "Switzerland", // origin_country
  1700000000, // time_position
  1700000005, // last_contact
  8.55, // longitude
  47.45, // latitude
  10972.8, // baro_altitude
  false, // on_ground
  246.7, // velocity
  93.4, // true_track
  0, // vertical_rate
  null, // sensors
  11000, // geo_altitude
  "1000", // squawk
  false, // spi
  0, // position_source
];

describe("parseStateVector", () => {
  it("normalizes a valid state vector and trims the callsign", () => {
    const flight = parseStateVector(sample);
    expect(flight).not.toBeNull();
    expect(flight?.icao24).toBe("4b1814");
    expect(flight?.callsign).toBe("SWR123");
    expect(flight?.originCountry).toBe("Switzerland");
    expect(flight?.longitude).toBe(8.55);
    expect(flight?.latitude).toBe(47.45);
    expect(flight?.heading).toBe(93.4);
    expect(flight?.onGround).toBe(false);
    expect(() => new Date(flight!.lastContact).toISOString()).not.toThrow();
  });

  it("drops a state vector with no position (null lat/lon)", () => {
    const noPos = [...sample];
    noPos[5] = null;
    noPos[6] = null;
    expect(parseStateVector(noPos)).toBeNull();
  });

  it("tolerates an extra trailing category field", () => {
    expect(parseStateVector([...sample, 1])).not.toBeNull();
  });

  it("returns null for a malformed row", () => {
    expect(parseStateVector(["only", "two"])).toBeNull();
  });
});

describe("parseStatesResponse", () => {
  it("parses many states and filters out bad ones", () => {
    const noPos = [...sample];
    noPos[5] = null;
    noPos[6] = null;
    const flights = parseStatesResponse({ time: 1700000005, states: [sample, noPos, "junk"] });
    expect(flights).toHaveLength(1);
    expect(flights[0]?.icao24).toBe("4b1814");
  });

  it("returns [] when states is null", () => {
    expect(parseStatesResponse({ time: 1, states: null })).toEqual([]);
  });
});
