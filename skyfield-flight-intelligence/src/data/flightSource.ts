import type { Flight, FlightProvider } from "./types.js";
import { SampleFlightProvider } from "./sampleFlights.js";
import { createFabricFlightProvider } from "./fabric/fabricProvider.js";

/**
 * What the 3D scene reads from. Both demo and live implementations expose the
 * same surface: `current()` for the render loop and `advance()` for per-frame
 * dead-reckoning between authoritative updates.
 */
export interface FlightSource {
  readonly name: string;
  readonly isLive: boolean;
  current(): Flight[];
  advance(dtSeconds: number): void;
  setCount?(count: number): void;
  start?(): void;
  stop?(): void;
  /** Live only: when the newest row was ingested (epoch ms). */
  lastUpdate?(): number | null;
}

const METRES_PER_DEGREE = 111_320;
/** Without fresh data for this long, live planes stop moving instead of flying on blind. */
const MAX_COAST_MS = 30_000;
/** Data reaches the app a couple of minutes late; never guess further ahead than this. */
const MAX_CATCH_UP_MS = 180_000;

/**
 * Dead-reckon airborne live flights along their heading at their real speed, so a plane stays on its true track
 * (and its drawn route) between polls. Any exaggeration here walks planes hundreds of km off their routes.
 */
export function deadReckon(flights: Flight[], dtSeconds: number): void {
  for (const f of flights) {
    if (f.onGround || f.velocity == null || f.heading == null) continue;
    const degPerSec = f.velocity / METRES_PER_DEGREE;
    const rad = (f.heading * Math.PI) / 180;
    // a degree of longitude shrinks with latitude
    const lonScale = Math.max(Math.cos((f.latitude * Math.PI) / 180), 0.05);
    f.latitude += Math.cos(rad) * degPerSec * dtSeconds;
    f.longitude += (Math.sin(rad) * degPerSec * dtSeconds) / lonScale;
    if (f.latitude > 85 || f.latitude < -85) f.heading = (f.heading + 180) % 360;
    if (f.longitude > 180) f.longitude -= 360;
    if (f.longitude < -180) f.longitude += 360;
  }
}

/**
 * Moves each plane from where it was last heard to where it should be now. The feed's rows arrive about two
 * minutes old, so without this every aircraft is drawn tens of km behind its real position.
 */
export function catchUp(flights: Flight[], nowMs: number): void {
  for (const f of flights) {
    if (f.positionTime == null) continue;
    const ageMs = Math.min(Math.max(nowMs - f.positionTime, 0), MAX_CATCH_UP_MS);
    deadReckon([f], ageMs / 1000);
  }
}

/**
 * Live source backed by the Fabric semantic model. Polls authoritative
 * positions on an interval and dead-reckons between polls so motion stays
 * smooth despite the ~8s refresh.
 */
export class LiveFlightSource implements FlightSource {
  readonly name = "fabric";
  readonly isLive = true;
  private flights: Flight[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastGoodPoll = 0;
  private lastTick = 0;
  private polling = false;
  private readonly onVisible = () => void this.poll();

  constructor(
    private readonly provider: FlightProvider,
    private readonly intervalMs = 8000,
  ) {}

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    // refresh at once when the tab comes back, instead of showing old positions until the next tick
    globalThis.document?.addEventListener("visibilitychange", this.onVisible);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    globalThis.document?.removeEventListener("visibilitychange", this.onVisible);
  }

  private async poll(): Promise<void> {
    // One query at a time, and none from a hidden tab: each one pulls thousands of rows through a small shared
    // Fabric capacity, and on a slow capacity overlapping queries only make it slower.
    if (this.polling || globalThis.document?.hidden) return;
    this.polling = true;
    try {
      const flights = await this.provider.getFlights();
      catchUp(flights, Date.now());
      this.flights = flights;
      this.lastGoodPoll = performance.now();
    } catch {
      // keep the last good set; it coasts for MAX_COAST_MS, then holds still
    } finally {
      this.polling = false;
    }
  }

  /** Runs on the wall clock: live planes move in real time, whatever the sample-only speed slider says. */
  advance(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastTick) / 1000, 1);
    this.lastTick = now;
    if (now - this.lastGoodPoll > MAX_COAST_MS) return;
    deadReckon(this.flights, dt);
  }

  current(): Flight[] {
    return this.flights;
  }

  lastUpdate(): number | null {
    return this.provider.lastUpdate?.() ?? null;
  }
}

/**
 * True when the app is running embedded (i.e. inside the Fabric portal iframe).
 * A cross-origin access to `window.top` throws — which itself means we're
 * embedded under a different origin (the portal).
 */
function isFabricEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/**
 * Resolve the data source at runtime: live Fabric semantic-model data when
 * embedded in the portal, otherwise the animated sample fleet so the app always
 * renders (local dev / standalone). Force sample with VITE_FORCE_SAMPLE=true.
 */
export function resolveFlightSource(sampleCount = 1200): FlightSource {
  if (isFabricEmbedded() && import.meta.env.VITE_FORCE_SAMPLE !== "true") {
    const source = new LiveFlightSource(createFabricFlightProvider());
    source.start();
    return source;
  }
  return new SampleFlightProvider(sampleCount);
}
