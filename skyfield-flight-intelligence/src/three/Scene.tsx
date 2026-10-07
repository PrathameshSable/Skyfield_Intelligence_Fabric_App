import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, Billboard, Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { hasRoute, type Flight } from "../data/types.js";
import { latLonToVector3, type ColorMode } from "../lib/geo.js";
import { greatCircleArc } from "../lib/greatCircle.js";
import { Globe, GLOBE_RADIUS, type LightingMode } from "./Globe.js";
import { Aircraft } from "./Aircraft.js";
import { FlightArcs } from "./FlightArcs.js";

interface SceneProps {
  getFlights: () => Flight[];
  advance: (dt: number) => void;
  planeSize: number;
  speed: number;
  autoRotate: boolean;
  showArcs: boolean;
  showAirports: boolean;
  lighting: LightingMode;
  colorMode: ColorMode;
  follow: boolean;
  /** Re-frames the camera when this changes (e.g. the selected country). */
  frameKey: string;
  filterFn?: (f: Flight) => boolean;
  selected: Flight | null;
  onSelect: (flight: Flight) => void;
  onClearSelection: () => void;
}

/** Bright gold great-circle arc + airport endpoints for the selected flight. */
function SelectedRoute({ flight }: { flight: Flight }) {
  const points = useMemo(() => {
    if (!hasRoute(flight)) return null;
    return greatCircleArc(
      flight.originLat!, flight.originLon!, flight.destLat!, flight.destLon!,
      GLOBE_RADIUS * 1.016, { steps: 64 },
    );
  }, [flight]);
  if (!points) return null;
  const o = latLonToVector3(flight.originLat!, flight.originLon!, GLOBE_RADIUS * 1.014);
  const d = latLonToVector3(flight.destLat!, flight.destLon!, GLOBE_RADIUS * 1.014);
  return (
    <group>
      <Line points={points} color="#ffd166" lineWidth={2.5} transparent opacity={0.95} />
      <mesh position={[o.x, o.y, o.z]}>
        <sphereGeometry args={[0.022, 12, 12]} />
        <meshBasicMaterial color="#5ff0a0" />
      </mesh>
      <mesh position={[d.x, d.y, d.z]}>
        <sphereGeometry args={[0.022, 12, 12]} />
        <meshBasicMaterial color="#ff8c6b" />
      </mesh>
      {flight.originIata && (
        <Html position={[o.x, o.y, o.z]} center>
          <div className="airport-label origin">{flight.originIata}</div>
        </Html>
      )}
      {flight.destIata && (
        <Html position={[d.x, d.y, d.z]} center>
          <div className="airport-label dest">{flight.destIata}</div>
        </Html>
      )}
    </group>
  );
}

interface Airport {
  iata: string;
  lat: number;
  lon: number;
  count: number;
}

/** Traffic heat ramp: cool blue (quiet) → amber → hot red (busy). */
function heatColor(t: number): THREE.Color {
  return new THREE.Color().setHSL(0.6 - 0.6 * t, 0.85, 0.42 + 0.13 * t);
}

/** Markers + labels for every airport that's an endpoint of a visible route. */
function Airports({
  getFlights,
  filterFn,
}: {
  getFlights: () => Flight[];
  filterFn?: (f: Flight) => boolean;
}) {
  const [airports, setAirports] = useState<Airport[]>([]);

  useEffect(() => {
    const compute = () => {
      const all = getFlights();
      const flights = filterFn ? all.filter(filterFn) : all;
      const map = new Map<string, Airport>();
      const add = (iata: string | null, lat: number | null, lon: number | null) => {
        if (!iata || lat == null || lon == null) return;
        const e = map.get(iata) ?? { iata, lat, lon, count: 0 };
        e.count++;
        map.set(iata, e);
      };
      for (const f of flights) {
        add(f.originIata, f.originLat, f.originLon);
        add(f.destIata, f.destLat, f.destLon);
      }
      setAirports([...map.values()].sort((a, b) => b.count - a.count).slice(0, 80));
    };
    compute();
    const id = setInterval(compute, 1500);
    return () => clearInterval(id);
  }, [getFlights, filterFn]);

  const maxCount = Math.max(6, airports[0]?.count ?? 1);
  return (
    <group>
      {airports.map((a, i) => {
        const p = latLonToVector3(a.lat, a.lon, GLOBE_RADIUS * 1.013);
        const t = Math.min(1, a.count / maxCount);
        const r = 0.006 + t * 0.014;
        const col = heatColor(t);
        return (
          <group key={a.iata} position={[p.x, p.y, p.z]}>
            <mesh>
              <sphereGeometry args={[r, 10, 10]} />
              <meshBasicMaterial color={col} toneMapped={false} />
            </mesh>
            {t > 0.35 && (
              <mesh scale={1.9}>
                <sphereGeometry args={[r, 10, 10]} />
                <meshBasicMaterial
                  color={col}
                  transparent
                  opacity={0.1}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            )}
            {i < 22 && (
              <Html center distanceFactor={10} occlude>
                <div className="airport-tag">{a.iata}</div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Keeps the selected aircraft centered as it moves (re-finds it by icao24). */
function FollowCamera({
  getFlights,
  icao24,
}: {
  getFlights: () => Flight[];
  icao24: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useThree((s) => s.controls) as any;
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!controls) return;
    const f = getFlights().find((x) => x.icao24 === icao24);
    if (!f) return;
    latLonToVector3(f.latitude, f.longitude, 1, tmp);
    controls.setPolarAngle(Math.acos(THREE.MathUtils.clamp(tmp.y, -1, 1)));
    controls.setAzimuthalAngle(Math.atan2(tmp.x, tmp.z));
    controls.update();
  });
  return null;
}

/**
 * Frames the view on the centroid of the visible flights. Re-frames whenever
 * `frameKey` changes (e.g. you pick a country), so the globe jumps to that
 * region instead of leaving you staring at the wrong hemisphere.
 */
function AutoFrame({
  getFlights,
  filterFn,
  frameKey,
}: {
  getFlights: () => Flight[];
  filterFn?: (f: Flight) => boolean;
  frameKey: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useThree((s) => s.controls) as any;
  const doneKey = useRef<string | null>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!controls || doneKey.current === frameKey) return;
    const all = getFlights();
    const flights = filterFn ? all.filter(filterFn) : all;
    if (flights.length < 1) return;
    const c = new THREE.Vector3();
    let n = 0;
    for (const f of flights) {
      c.add(latLonToVector3(f.latitude, f.longitude, 1, tmp));
      if (++n > 800) break;
    }
    if (c.lengthSq() < 1e-6) {
      doneKey.current = frameKey;
      return;
    }
    c.normalize();
    controls.setPolarAngle(Math.acos(THREE.MathUtils.clamp(c.y, -1, 1)));
    controls.setAzimuthalAngle(Math.atan2(c.x, c.z));
    controls.update();
    doneKey.current = frameKey;
  });
  return null;
}

/** A pulsing ring that marks the currently selected aircraft. */
function SelectionMarker({ flight }: { flight: Flight }) {
  const ref = useRef<THREE.Mesh>(null);
  const pos = latLonToVector3(flight.latitude, flight.longitude, GLOBE_RADIUS * 1.02);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 4) * 0.15;
      ref.current.scale.setScalar(s);
    }
  });
  return (
    <Billboard position={[pos.x, pos.y, pos.z]}>
      <mesh ref={ref}>
        <ringGeometry args={[0.045, 0.07, 32]} />
        <meshBasicMaterial color="#ffd166" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
    </Billboard>
  );
}

export function Scene(props: SceneProps) {
  const {
    getFlights, advance, planeSize, speed, autoRotate, showArcs, showAirports, lighting,
    colorMode, follow, frameKey, filterFn, selected, onSelect, onClearSelection,
  } = props;
  const following = follow && selected != null;
  // Stop spinning while you're inspecting a specific country or following a plane.
  const spin = autoRotate && !following && frameKey === "";

  return (
    <Canvas
      camera={{ position: [0, 1.6, 6], fov: 45 }}
      dpr={[1, 2]}
      raycaster={{ params: { Points: { threshold: 0.04 } } as THREE.RaycasterParameters }}
      onPointerMissed={onClearSelection}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#03060f"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 3, 5]} intensity={1.4} color="#fff6e8" />
      <Stars radius={120} depth={60} count={6000} factor={4} saturation={0} fade speed={0.6} />

      <Globe lighting={lighting} />
      {/* Hide the whole route web while one flight is selected, to focus on it. */}
      {showArcs && !selected && (
        <FlightArcs getFlights={getFlights} colorMode={colorMode} filterFn={filterFn} />
      )}
      {showAirports && <Airports getFlights={getFlights} filterFn={filterFn} />}
      <Aircraft
        getFlights={getFlights}
        advance={advance}
        size={planeSize}
        speed={speed}
        colorMode={colorMode}
        filterFn={filterFn}
        onSelect={onSelect}
      />
      {selected && <SelectionMarker flight={selected} />}
      {selected && <SelectedRoute flight={selected} />}
      <AutoFrame getFlights={getFlights} filterFn={filterFn} frameKey={frameKey} />
      {following && <FollowCamera getFlights={getFlights} icao24={selected!.icao24} />}

      <OrbitControls
        makeDefault
        enablePan={false}
        autoRotate={spin}
        autoRotateSpeed={0.35}
        minDistance={3.2}
        maxDistance={12}
        rotateSpeed={0.5}
      />
    </Canvas>
  );
}
