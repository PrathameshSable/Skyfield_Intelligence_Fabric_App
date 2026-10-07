import type { Flight, FlightProvider } from "./types.js";

/**
 * Generates a realistic-looking fleet of aircraft and advances them along their
 * heading each tick, so the globe is alive without Fabric. Swap this for the
 * Fabric provider (see ./fabric/) to render real OpenSky data.
 */
const COUNTRIES = [
  "United States", "Germany", "United Kingdom", "France", "Spain",
  "Italy", "Netherlands", "Canada", "Japan", "Brazil", "Australia",
  "India", "China", "United Arab Emirates", "Turkey", "Switzerland",
];

const AIRLINE_PREFIXES = ["UAL", "DLH", "BAW", "AFR", "KLM", "AAL", "SWR", "UAE", "QFA", "ANA", "THY"];

// Major airports [iata, lat, lon] for synthetic routes in demo mode.
const AIRPORTS: [string, number, number][] = [
  ["LHR", 51.47, -0.46], ["JFK", 40.64, -73.78], ["LAX", 33.94, -118.41],
  ["CDG", 49.01, 2.55], ["FRA", 50.04, 8.56], ["DXB", 25.25, 55.36],
  ["HND", 35.55, 139.78], ["SIN", 1.36, 103.99], ["SYD", -33.95, 151.18],
  ["GRU", -23.43, -46.47], ["JNB", -26.13, 28.24], ["ORD", 41.97, -87.91],
  ["AMS", 52.31, 4.76], ["IST", 41.26, 28.74], ["HKG", 22.31, 113.91],
  ["DEL", 28.56, 77.10], ["MAD", 40.47, -3.56], ["YYZ", 43.68, -79.61],
];

function pickRoute(): { o: [string, number, number]; d: [string, number, number] } {
  const o = AIRPORTS[Math.floor(Math.random() * AIRPORTS.length)]!;
  let d = AIRPORTS[Math.floor(Math.random() * AIRPORTS.length)]!;
  while (d === o) d = AIRPORTS[Math.floor(Math.random() * AIRPORTS.length)]!;
  return { o, d };
}

const AIRLINES = [
  "United Airlines", "Lufthansa", "British Airways", "Air France", "KLM",
  "American Airlines", "Swiss", "Emirates", "Qantas", "ANA", "Turkish Airlines",
];
const AIRFRAMES: [string, string][] = [
  ["Boeing", "Boeing 737-800"], ["Boeing", "Boeing 777-300ER"], ["Boeing", "Boeing 787-9"],
  ["Airbus", "Airbus A320neo"], ["Airbus", "Airbus A321"], ["Airbus", "Airbus A350-900"],
  ["Airbus", "Airbus A330-300"], ["Embraer", "Embraer E190"], ["Boeing", "Boeing 737 MAX 8"],
];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Weighted country picker so "busiest airspace" looks realistic (a few hubs
// dominate) instead of a perfectly even split.
const COUNTRY_WEIGHTS = [
  26, 14, 11, 9, 8, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1,
];
const WEIGHT_TOTAL = COUNTRY_WEIGHTS.reduce((a, b) => a + b, 0);

function pickCountry(): string {
  let r = Math.random() * WEIGHT_TOTAL;
  for (let i = 0; i < COUNTRIES.length; i++) {
    r -= COUNTRY_WEIGHTS[i]!;
    if (r <= 0) return COUNTRIES[i]!;
  }
  return COUNTRIES[0]!;
}

function makeFlight(i: number): Flight {
  const onGround = Math.random() < 0.08;
  const prefix = AIRLINE_PREFIXES[i % AIRLINE_PREFIXES.length];
  // ~75% of flights resolve a route (mirrors how many real callsigns adsbdb knows).
  const route = !onGround && Math.random() < 0.75 ? pickRoute() : null;
  return {
    icao24: (0x400000 + i).toString(16),
    callsign: `${prefix}${100 + (i % 900)}`,
    originCountry: pickCountry(),
    longitude: rand(-180, 180),
    latitude: rand(-75, 75),
    geoAltitude: onGround ? 0 : rand(2000, 12500),
    velocity: onGround ? rand(0, 30) : rand(180, 280),
    heading: rand(0, 360),
    verticalRate: onGround ? 0 : rand(-6, 6),
    onGround,
    originLat: route?.o[1] ?? null,
    originLon: route?.o[2] ?? null,
    destLat: route?.d[1] ?? null,
    destLon: route?.d[2] ?? null,
    originIata: route?.o[0] ?? null,
    destIata: route?.d[0] ?? null,
    airline: route ? AIRLINES[i % AIRLINES.length]! : null,
    manufacturer: route ? AIRFRAMES[i % AIRFRAMES.length]![0] : null,
    aircraftType: route ? AIRFRAMES[i % AIRFRAMES.length]![1] : null,
  };
}

export class SampleFlightProvider implements FlightProvider {
  readonly name = "sample";
  readonly isLive = false;
  private flights: Flight[];

  constructor(count = 900) {
    this.flights = Array.from({ length: count }, (_, i) => makeFlight(i));
  }

  setCount(count: number): void {
    if (count > this.flights.length) {
      const extra = Array.from({ length: count - this.flights.length }, (_, k) =>
        makeFlight(this.flights.length + k),
      );
      this.flights = [...this.flights, ...extra];
    } else {
      this.flights = this.flights.slice(0, count);
    }
  }

  /** Advance each airborne flight along its heading. dtSeconds scales motion. */
  advance(dtSeconds: number): void {
    for (const f of this.flights) {
      if (f.onGround || f.velocity == null || f.heading == null) continue;
      // Convert m/s → degrees; exaggerate so motion is visible.
      const degPerSec = (f.velocity / 111_320) * 60;
      const rad = (f.heading * Math.PI) / 180;
      f.latitude += Math.cos(rad) * degPerSec * dtSeconds;
      f.longitude += Math.sin(rad) * degPerSec * dtSeconds;
      if (f.latitude > 85 || f.latitude < -85) f.heading = (f.heading + 180) % 360;
      if (f.longitude > 180) f.longitude -= 360;
      if (f.longitude < -180) f.longitude += 360;
    }
  }

  async getFlights(): Promise<Flight[]> {
    return this.flights;
  }

  /** Synchronous accessor for the render loop. */
  current(): Flight[] {
    return this.flights;
  }
}
