import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { hasRoute, type Flight } from "../data/types.js";
import { flightColor, type ColorMode } from "../lib/geo.js";
import { forwardArc, greatCircleArc } from "../lib/greatCircle.js";
import { GLOBE_RADIUS } from "./Globe.js";

const MAX_ARCS = 700;
const ROUTE_STEPS = 26;
const SURFACE = GLOBE_RADIUS * 1.012;
const MAX_VERTS = MAX_ARCS * ROUTE_STEPS * 2;

interface FlightArcsProps {
  getFlights: () => Flight[];
  colorMode: ColorMode;
  filterFn?: (f: Flight) => boolean;
}

/**
 * Flight-path arcs. When a flight has a resolved route (origin + destination
 * airports), draws the full great-circle arc between them — like an airline
 * route map. Otherwise falls back to a short velocity-based heading trail.
 * Altitude-colored, rebuilt a few times a second. Rebuilt off-frame for perf.
 */
export function FlightArcs({ getFlights, colorMode, filterFn }: FlightArcsProps) {
  const acc = useRef(0);

  const segments = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3), 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    return new THREE.LineSegments(geometry, material);
  }, []);

  const rebuild = () => {
    const all = getFlights();
    const flights = filterFn ? all.filter(filterFn) : all;
    const pos = segments.geometry.attributes.position as THREE.BufferAttribute;
    const col = segments.geometry.attributes.color as THREE.BufferAttribute;
    const posArr = pos.array as Float32Array;
    const colArr = col.array as Float32Array;

    let v = 0;
    const count = Math.min(flights.length, MAX_ARCS);
    for (let i = 0; i < count && v + ROUTE_STEPS * 2 <= MAX_VERTS; i++) {
      const f = flights[i]!;
      const [r, g, b] = flightColor(f.geoAltitude, f.originCountry, colorMode);

      let arc: THREE.Vector3[];
      let fade = false;
      if (hasRoute(f)) {
        arc = greatCircleArc(f.originLat!, f.originLon!, f.destLat!, f.destLon!, SURFACE, {
          steps: ROUTE_STEPS,
        });
      } else {
        const speed = f.velocity ?? 0;
        if (f.onGround || f.heading == null || speed < 20) continue;
        const arcDeg = Math.max(0.5, Math.min(4, (speed * 720) / 111_320));
        arc = forwardArc(f.latitude, f.longitude, f.heading, SURFACE, { steps: 12, arcDeg, lift: 0.02 });
        fade = true;
      }

      for (let s = 0; s < arc.length - 1; s++) {
        const a = arc[s]!;
        const b2 = arc[s + 1]!;
        const f0 = fade ? 1 - s / arc.length : 1;
        const f1 = fade ? 1 - (s + 1) / arc.length : 1;
        posArr[v * 3] = a.x; posArr[v * 3 + 1] = a.y; posArr[v * 3 + 2] = a.z;
        colArr[v * 3] = r * f0; colArr[v * 3 + 1] = g * f0; colArr[v * 3 + 2] = b * f0;
        v++;
        posArr[v * 3] = b2.x; posArr[v * 3 + 1] = b2.y; posArr[v * 3 + 2] = b2.z;
        colArr[v * 3] = r * f1; colArr[v * 3 + 1] = g * f1; colArr[v * 3 + 2] = b * f1;
        v++;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    segments.geometry.setDrawRange(0, v);
  };

  useFrame((_, delta) => {
    acc.current += delta;
    if (acc.current >= 0.4) {
      acc.current = 0;
      rebuild();
    }
  });

  return <primitive object={segments} />;
}
