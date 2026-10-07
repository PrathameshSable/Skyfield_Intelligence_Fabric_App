import * as THREE from "three";
import { latLonToVector3 } from "./geo.js";

const DEG = Math.PI / 180;

/**
 * Destination point reached from (lat,lon) on a great circle, given an initial
 * bearing and an angular distance (all degrees). Standard spherical formula.
 */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  angularDeg: number,
): { lat: number; lon: number } {
  const φ1 = lat * DEG;
  const λ1 = lon * DEG;
  const θ = bearingDeg * DEG;
  const δ = angularDeg * DEG;

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * sinφ2,
    );

  return { lat: φ2 / DEG, lon: ((λ2 / DEG + 540) % 360) - 180 };
}

/**
 * Great-circle arc between two lat/lon points (slerp on the unit sphere),
 * bowed outward in the middle — higher for longer routes — for an airport→
 * airport route arc like the reference tracker.
 */
export function greatCircleArc(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  baseRadius: number,
  opts: { steps?: number; maxLift?: number } = {},
): THREE.Vector3[] {
  const { steps = 24 } = opts;
  const p1 = latLonToVector3(lat1, lon1, 1);
  const p2 = latLonToVector3(lat2, lon2, 1);
  const omega = Math.acos(Math.max(-1, Math.min(1, p1.dot(p2))));
  const sinOmega = Math.sin(omega);
  const maxLift = opts.maxLift ?? Math.max(0.05, Math.min(0.6, omega * 0.35));

  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let v: THREE.Vector3;
    if (sinOmega < 1e-6) {
      v = p1.clone();
    } else {
      const a = Math.sin((1 - t) * omega) / sinOmega;
      const b = Math.sin(t * omega) / sinOmega;
      v = p1.clone().multiplyScalar(a).add(p2.clone().multiplyScalar(b));
    }
    v.normalize().multiplyScalar(baseRadius * (1 + maxLift * Math.sin(t * Math.PI)));
    pts.push(v);
  }
  return pts;
}

/**
 * Forward great-circle trajectory points from a position along its heading,
 * each lifted slightly off the sphere to bow the arc outward for depth.
 */
export function forwardArc(
  lat: number,
  lon: number,
  headingDeg: number,
  baseRadius: number,
  opts: { arcDeg?: number; steps?: number; lift?: number } = {},
): THREE.Vector3[] {
  const { arcDeg = 22, steps = 14, lift = 0.05 } = opts;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const d = destinationPoint(lat, lon, headingDeg, arcDeg * t);
    const r = baseRadius * (1 + lift * Math.sin(t * Math.PI));
    const phi = (90 - d.lat) * DEG;
    const theta = (d.lon + 180) * DEG;
    pts.push(
      new THREE.Vector3(
        -r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta),
      ),
    );
  }
  return pts;
}
