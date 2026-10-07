import type { Flight } from "./types.js";

export type AltitudeBand = "all" | "low" | "mid" | "high";

export interface FlightFilter {
  text: string;
  band: AltitudeBand;
  airborneOnly: boolean;
  /** Only scheduled/commercial flights (airline-format callsigns). */
  airlinesOnly: boolean;
  /** Empty = all countries. */
  country: string;
  /** Empty = all airlines. */
  airline: string;
  /** Empty = all manufacturers (Boeing / Airbus / …). */
  manufacturer: string;
}

export const EMPTY_FILTER: FlightFilter = {
  text: "",
  band: "all",
  airborneOnly: false,
  airlinesOnly: false,
  country: "",
  airline: "",
  manufacturer: "",
};

/** Default view: airborne commercial flights only (hide GA / military / private). */
export const DEFAULT_FILTER: FlightFilter = {
  ...EMPTY_FILTER,
  airborneOnly: true,
  airlinesOnly: true,
};

/** Airline-format callsign: 3-letter ICAO airline code + flight number, e.g. AAL2412. */
const AIRLINE_CALLSIGN = /^[A-Z]{3}\d/;

export function isFilterActive(f: FlightFilter): boolean {
  return (
    f.text.trim() !== "" ||
    f.band !== "all" ||
    f.airborneOnly ||
    f.airlinesOnly ||
    f.country !== "" ||
    f.airline !== "" ||
    f.manufacturer !== ""
  );
}

const FT = 3.28084;

export function matchesFilter(flight: Flight, filter: FlightFilter): boolean {
  if (filter.airborneOnly && flight.onGround) return false;
  if (filter.airlinesOnly && !(flight.callsign && AIRLINE_CALLSIGN.test(flight.callsign))) {
    return false;
  }
  if (filter.country && flight.originCountry !== filter.country) return false;
  if (filter.airline && flight.airline !== filter.airline) return false;
  if (filter.manufacturer && flight.manufacturer !== filter.manufacturer) return false;

  if (filter.band !== "all") {
    const ft = (flight.geoAltitude ?? 0) * FT;
    if (filter.band === "low" && ft >= 10_000) return false;
    if (filter.band === "mid" && (ft < 10_000 || ft > 30_000)) return false;
    if (filter.band === "high" && ft <= 30_000) return false;
  }

  const q = filter.text.trim().toLowerCase();
  if (q) {
    const hay = `${flight.callsign ?? ""} ${flight.originCountry} ${flight.icao24}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Build a stable predicate for the current filter. */
export function makeFilterFn(filter: FlightFilter): (f: Flight) => boolean {
  return (f) => matchesFilter(f, filter);
}
