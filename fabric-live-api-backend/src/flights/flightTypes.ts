import { z } from "zod";
import type { StreamEvent } from "../types.js";

/**
 * OpenSky `/states/all` returns each aircraft as a positional **state vector**
 * (a heterogeneous array), documented here:
 * https://openskynetwork.github.io/opensky-api/rest.html#response
 *
 * Index → field:
 *  0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact,
 *  5 longitude, 6 latitude, 7 baro_altitude, 8 on_ground, 9 velocity,
 *  10 true_track, 11 vertical_rate, 12 sensors, 13 geo_altitude, 14 squawk,
 *  15 spi, 16 position_source, 17 category (optional).
 */
export const StateVectorSchema = z.tuple([
  z.string(), // icao24
  z.string().nullable(), // callsign
  z.string(), // origin_country
  z.number().nullable(), // time_position
  z.number(), // last_contact
  z.number().nullable(), // longitude
  z.number().nullable(), // latitude
  z.number().nullable(), // baro_altitude
  z.boolean(), // on_ground
  z.number().nullable(), // velocity
  z.number().nullable(), // true_track
  z.number().nullable(), // vertical_rate
  z.array(z.number()).nullable(), // sensors
  z.number().nullable(), // geo_altitude
  z.string().nullable(), // squawk
  z.boolean(), // spi
  z.number(), // position_source
]).rest(z.unknown()); // tolerate the optional trailing category / future fields

export const StatesResponseSchema = z.object({
  time: z.number(),
  states: z.array(z.unknown()).nullable(),
});

/** A single normalized aircraft, ready for the Eventstream / Eventhouse. */
export type FlightEvent = {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  longitude: number;
  latitude: number;
  geoAltitude: number | null;
  baroAltitude: number | null;
  velocity: number | null;
  /** Heading in degrees (true track). */
  heading: number | null;
  verticalRate: number | null;
  onGround: boolean;
  /** Last position contact (ISO 8601, UTC). */
  lastContact: string;
  /** When this service ingested it (ISO 8601, UTC). */
  ingestedAt: string;
};

/**
 * Parse one raw state vector. Returns `null` when the row is malformed or has
 * no usable position (lat/lon null) — those are filtered out upstream.
 */
export function parseStateVector(raw: unknown): FlightEvent | null {
  const parsed = StateVectorSchema.safeParse(raw);
  if (!parsed.success) return null;

  const v = parsed.data;
  const longitude = v[5];
  const latitude = v[6];
  if (longitude === null || latitude === null) return null;

  const now = new Date();
  return {
    icao24: v[0],
    callsign: v[1] ? v[1].trim() : null,
    originCountry: v[2],
    longitude,
    latitude,
    baroAltitude: v[7],
    onGround: v[8],
    velocity: v[9],
    heading: v[10],
    verticalRate: v[11],
    geoAltitude: v[13],
    lastContact: new Date(v[4] * 1000).toISOString(),
    ingestedAt: now.toISOString(),
  };
}

/** Parse a full `/states/all` response into normalized flight events. */
export function parseStatesResponse(raw: unknown): FlightEvent[] {
  const parsed = StatesResponseSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.states) return [];

  const flights: FlightEvent[] = [];
  for (const row of parsed.data.states) {
    const flight = parseStateVector(row);
    if (flight) flights.push(flight);
  }
  return flights;
}

/** Widen a FlightEvent to the generic stream-event shape. */
export function flightToStreamEvent(flight: FlightEvent): StreamEvent {
  return flight;
}
