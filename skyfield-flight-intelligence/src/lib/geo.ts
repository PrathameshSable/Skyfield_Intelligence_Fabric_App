import * as THREE from "three";

/** Convert lat/lon (degrees) to a point on a sphere of the given radius. */
export function latLonToVector3(
  lat: number,
  lon: number,
  radius: number,
  target = new THREE.Vector3(),
): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  target.set(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
  return target;
}

/** A cool→hot color ramp by normalized altitude (0..1), as an RGB triple. */
export function altitudeColor(altMeters: number | null): [number, number, number] {
  const t = Math.max(0, Math.min(1, (altMeters ?? 0) / 13000));
  // teal (low) → amber (mid) → magenta (high)
  const c = new THREE.Color();
  c.setHSL(0.55 - 0.45 * t, 0.85, 0.55);
  return [c.r, c.g, c.b];
}

export type ColorMode = "altitude" | "country";

/** Stable, well-spread color per country (hash → hue). */
export function countryColor(country: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < country.length; i++) h = (h * 31 + country.charCodeAt(i)) >>> 0;
  // Golden-ratio hop spreads adjacent hashes apart for distinct hues.
  const hue = (((h % 360) / 360) * 0.61803398875 * 360) % 360;
  const c = new THREE.Color();
  c.setHSL(hue / 360, 0.72, 0.62);
  return [c.r, c.g, c.b];
}

/** Color a flight by the chosen mode. */
export function flightColor(
  altMeters: number | null,
  country: string,
  mode: ColorMode,
): [number, number, number] {
  return mode === "country" ? countryColor(country) : altitudeColor(altMeters);
}
