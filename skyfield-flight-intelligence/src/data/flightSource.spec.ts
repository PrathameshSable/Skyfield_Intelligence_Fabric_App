import { describe, it, expect, vi } from "vitest";
import { catchUp, deadReckon, LiveFlightSource } from "./flightSource.js";
import type { Flight, FlightProvider } from "./types.js";

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

describe("catchUp", () => {
  const now = Date.UTC(2026, 10, 12, 12, 0, 0);
  it("moves a plane forward by the age of its position", () => {
    const f = at(0, 0, { positionTime: now - 120_000 }); // two minutes old, due north
    catchUp([f], now);
    expect(f.latitude).toBeCloseTo(0.12, 6);
  });
  it("never guesses more than three minutes ahead", () => {
    const f = at(0, 0, { positionTime: now - 3_600_000 });
    catchUp([f], now);
    expect(f.latitude).toBeCloseTo(0.18, 6);
  });
  it("leaves planes with no time, or a time in the future, where they are", () => {
    const none = at(0, 0);
    const ahead = at(0, 0, { positionTime: now + 60_000 }); // viewer's clock is behind
    catchUp([none, ahead], now);
    expect(none.latitude).toBe(0);
    expect(ahead.latitude).toBe(0);
  });
});

describe("LiveFlightSource polling", () => {
  it("does not start a second query while one is still running", async () => {
    vi.useFakeTimers();
    let finish: (flights: Flight[]) => void = () => {};
    const getFlights = vi.fn(() => new Promise<Flight[]>((resolve) => (finish = resolve)));
    const source = new LiveFlightSource({ name: "slow", getFlights } as FlightProvider, 8000);
    source.start();
    await vi.advanceTimersByTimeAsync(24_000); // three more ticks while the first query hangs
    expect(getFlights).toHaveBeenCalledTimes(1);
    finish([]);
    await vi.advanceTimersByTimeAsync(8000);
    expect(getFlights).toHaveBeenCalledTimes(2);
    source.stop();
    vi.useRealTimers();
  });
});
