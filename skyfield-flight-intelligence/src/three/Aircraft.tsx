import { useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { Flight } from "../data/types.js";
import { flightColor, latLonToVector3, type ColorMode } from "../lib/geo.js";
import { GLOBE_RADIUS } from "./Globe.js";

const MAX = 5000;
const SURFACE = GLOBE_RADIUS * 1.02;

/** Top-view airplane silhouette, nose at +Y, lying in the local XY plane. */
function planeGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.62);
  s.lineTo(0.09, 0.18);
  s.lineTo(0.55, -0.02);
  s.lineTo(0.55, -0.14);
  s.lineTo(0.09, -0.04);
  s.lineTo(0.07, -0.4);
  s.lineTo(0.24, -0.52);
  s.lineTo(0.24, -0.62);
  s.lineTo(0, -0.48);
  s.lineTo(-0.24, -0.62);
  s.lineTo(-0.24, -0.52);
  s.lineTo(-0.07, -0.4);
  s.lineTo(-0.09, -0.04);
  s.lineTo(-0.55, -0.14);
  s.lineTo(-0.55, -0.02);
  s.lineTo(-0.09, 0.18);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.center();
  return g;
}

interface AircraftProps {
  getFlights: () => Flight[];
  advance: (dt: number) => void;
  size: number;
  speed: number;
  colorMode: ColorMode;
  filterFn?: (f: Flight) => boolean;
  onSelect: (flight: Flight) => void;
}

/**
 * Aircraft as heading-oriented plane glyphs (instanced). Each plane lies tangent
 * to the globe, nose pointing along its true track, colored by altitude or
 * origin country. Clickable via instanceId.
 */
export function Aircraft({ getFlights, advance, size, speed, colorMode, filterFn, onSelect }: AircraftProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const orderRef = useRef<Flight[]>([]);
  const geo = useMemo(planeGeometry, []);

  const t = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      up: new THREE.Vector3(),
      north: new THREE.Vector3(),
      east: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      right: new THREE.Vector3(),
      mat: new THREE.Matrix4(),
      obj: new THREE.Object3D(),
      color: new THREE.Color(),
    }),
    [],
  );

  useFrame((_, delta) => {
    advance(Math.min(delta, 0.1) * speed);
    const mesh = meshRef.current;
    if (!mesh) return;
    const all = getFlights();
    const flights = filterFn ? all.filter(filterFn) : all;
    orderRef.current = flights;
    const count = Math.min(flights.length, MAX);

    for (let i = 0; i < count; i++) {
      const f = flights[i]!;
      latLonToVector3(f.latitude, f.longitude, SURFACE, t.pos);
      t.up.copy(t.pos).normalize();
      // Local north / east tangents via finite difference.
      latLonToVector3(f.latitude + 0.5, f.longitude, SURFACE, t.north).sub(t.pos);
      latLonToVector3(f.latitude, f.longitude + 0.5, SURFACE, t.east).sub(t.pos);
      const h = ((f.heading ?? 0) * Math.PI) / 180;
      t.fwd
        .copy(t.north).multiplyScalar(Math.cos(h))
        .addScaledVector(t.east, Math.sin(h));
      t.fwd.addScaledVector(t.up, -t.fwd.dot(t.up)).normalize(); // project onto tangent plane
      t.right.crossVectors(t.fwd, t.up).normalize();
      t.mat.makeBasis(t.right, t.fwd, t.up);

      t.obj.quaternion.setFromRotationMatrix(t.mat);
      t.obj.position.copy(t.pos);
      t.obj.scale.setScalar(size);
      t.obj.updateMatrix();
      mesh.setMatrixAt(i, t.obj.matrix);

      const [r, g, b] = flightColor(f.geoAltitude, f.originCountry, colorMode);
      mesh.setColorAt(i, t.color.setRGB(r, g, b));
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId != null) {
      const flight = orderRef.current[e.instanceId];
      if (flight) onSelect(flight);
    }
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geo, undefined, MAX]}
      onClick={handleClick}
      frustumCulled={false}
    >
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}
