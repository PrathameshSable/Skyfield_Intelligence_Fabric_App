import { getFabricClient } from "@/lib/fabric-client";
import type { Flight, FlightProvider } from "../types.js";
import { LIVE_FLIGHTS_DAX } from "./flightQueries.js";

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

/** Normalize a result column name ("Flights[icao24]" / "[icao24]") → "icao24". */
function normalize(name: string): string {
  return name.replace(/^.*\[/, "").replace(/\]$/, "").trim().toLowerCase();
}

/** Map result rows → latest Flight per aircraft, BY COLUMN NAME (schema-safe). */
function rowsToLatestFlights(columns: { name: string }[], rows: unknown[][]): Flight[] {
  const idx = new Map<string, number>();
  columns.forEach((c, i) => idx.set(normalize(c.name), i));
  const g = (row: unknown[], name: string): unknown => {
    const i = idx.get(name);
    return i === undefined ? undefined : row[i];
  };

  const seen = new Set<string>();
  const flights: Flight[] = [];
  for (const row of rows) {
    const icao24 = String(g(row, "icao24") ?? "");
    if (!icao24 || seen.has(icao24)) continue; // newest-first → first wins
    seen.add(icao24);
    flights.push({
      icao24,
      callsign: str(g(row, "callsign")),
      originCountry: String(g(row, "origincountry") ?? "Unknown"),
      longitude: Number(g(row, "longitude") ?? 0),
      latitude: Number(g(row, "latitude") ?? 0),
      geoAltitude: num(g(row, "geoaltitude")),
      velocity: num(g(row, "velocity")),
      heading: num(g(row, "heading")),
      verticalRate: num(g(row, "verticalrate")),
      onGround: Boolean(g(row, "onground")),
      originLat: num(g(row, "originlat")),
      originLon: num(g(row, "originlon")),
      destLat: num(g(row, "destlat")),
      destLon: num(g(row, "destlon")),
      originIata: str(g(row, "originiata")),
      destIata: str(g(row, "destiata")),
      airline: str(g(row, "airline")),
      manufacturer: str(g(row, "manufacturer")),
      aircraftType: str(g(row, "aircrafttype")),
    });
  }
  return flights;
}

/**
 * Live provider backed by the Fabric semantic model. `bypassCache` is essential:
 * the query string is constant, so without it the SDK would serve the same stale
 * snapshot forever and the globe would freeze.
 */
export function createFabricFlightProvider(connection = "flightsModel"): FlightProvider {
  return {
    name: "fabric",
    async getFlights(): Promise<Flight[]> {
      const result = await getFabricClient()
        .semanticModel(connection)
        .query(LIVE_FLIGHTS_DAX, { bypassCache: true });
      if (result.status !== "success") {
        throw new Error(result.error.message);
      }
      return rowsToLatestFlights(result.table.columns, result.table.rows);
    },
  };
}
