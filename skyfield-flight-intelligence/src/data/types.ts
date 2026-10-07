/**
 * One aircraft, matching the backend's FlightEvent
 * (fabric-live-api-backend/src/flights/flightTypes.ts). This is the contract
 * shared by the sample provider and the live Fabric semantic-model provider.
 */
export interface Flight {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  longitude: number;
  latitude: number;
  geoAltitude: number | null;
  velocity: number | null; // m/s
  heading: number | null; // degrees (true track)
  verticalRate: number | null; // m/s
  onGround: boolean;
  // Route (from callsign → adsbdb lookup; null when unknown).
  originLat: number | null;
  originLon: number | null;
  destLat: number | null;
  destLon: number | null;
  originIata: string | null;
  destIata: string | null;
  // Operator + airframe (from adsbdb; null when unknown).
  airline: string | null;
  manufacturer: string | null;
  aircraftType: string | null;
}

/** True when a flight has a resolved origin→destination route. */
export function hasRoute(f: Flight): boolean {
  return (
    f.originLat != null && f.originLon != null && f.destLat != null && f.destLon != null
  );
}

/** A flight provider returns the current live set of aircraft. */
export interface FlightProvider {
  readonly name: string;
  /** Returns the latest known set of flights. */
  getFlights(): Promise<Flight[]>;
}

/** Aggregate stats derived from a flight set, for the HUD. */
export interface FlightStats {
  total: number;
  airborne: number;
  grounded: number;
  countries: number;
  avgAltitudeFt: number;
  avgSpeedKmh: number;
  topCountries: { country: string; count: number }[];
  altitudeBins: { label: string; count: number }[];
  manufacturers: { name: string; count: number }[];
}

const ALT_BANDS: { label: string; min: number; max: number }[] = [
  { label: "0–10k", min: 0, max: 10_000 },
  { label: "10–20k", min: 10_000, max: 20_000 },
  { label: "20–30k", min: 20_000, max: 30_000 },
  { label: "30–40k", min: 30_000, max: 40_000 },
  { label: "40k+", min: 40_000, max: Infinity },
];

export function computeStats(flights: Flight[]): FlightStats {
  let airborne = 0;
  let altSum = 0;
  let altCount = 0;
  let spdSum = 0;
  let spdCount = 0;
  const byCountry = new Map<string, number>();
  const byMaker = new Map<string, number>();
  const bins = ALT_BANDS.map((b) => ({ label: b.label, count: 0 }));

  for (const f of flights) {
    if (!f.onGround) airborne++;
    if (f.manufacturer) byMaker.set(f.manufacturer, (byMaker.get(f.manufacturer) ?? 0) + 1);
    if (f.geoAltitude != null) {
      altSum += f.geoAltitude;
      altCount++;
      if (!f.onGround) {
        const ft = f.geoAltitude * 3.28084;
        const bandIdx = ALT_BANDS.findIndex((b) => ft >= b.min && ft < b.max);
        if (bandIdx >= 0) bins[bandIdx]!.count++;
      }
    }
    if (f.velocity != null) {
      spdSum += f.velocity;
      spdCount++;
    }
    byCountry.set(f.originCountry, (byCountry.get(f.originCountry) ?? 0) + 1);
  }

  const topCountries = [...byCountry.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    total: flights.length,
    airborne,
    grounded: flights.length - airborne,
    countries: byCountry.size,
    avgAltitudeFt: altCount ? (altSum / altCount) * 3.28084 : 0,
    avgSpeedKmh: spdCount ? (spdSum / spdCount) * 3.6 : 0,
    topCountries,
    altitudeBins: bins,
    manufacturers: [...byMaker.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
  };
}
