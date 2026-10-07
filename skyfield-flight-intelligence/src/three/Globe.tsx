import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { latLonToVector3 } from "../lib/geo.js";

export const GLOBE_RADIUS = 2;

export type LightingMode = "realtime" | "day" | "night";

const DAY_URL = "/textures/earth-day.jpg";
const NIGHT_URL = "/textures/earth-night.jpg";

/** Subsolar point (where the sun is overhead) for a given UTC time. */
function subsolarPoint(date = new Date()): { lat: number; lon: number } {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear =
    (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - yearStart) / 86_400_000;
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const lon = -15 * (utcHours - 12);
  return { lat: declination, lon };
}

/**
 * Photoreal Earth: a day texture (NASA Blue Marble) blended with a night
 * texture (city lights) across a soft terminator driven by the real sun
 * position, plus a fresnel atmosphere. Falls back to a stylized sphere if the
 * textures don't load.
 */
export function Globe({ lighting = "realtime" }: { lighting?: LightingMode }) {
  const [maps, setMaps] = useState<{ day: THREE.Texture; night: THREE.Texture } | null>(null);
  const sunDir = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    let cancelled = false;
    Promise.all([loader.loadAsync(DAY_URL), loader.loadAsync(NIGHT_URL)])
      .then(([day, night]) => {
        if (cancelled) return;
        day.colorSpace = THREE.SRGBColorSpace;
        night.colorSpace = THREE.SRGBColorSpace;
        setMaps({ day, night });
      })
      .catch(() => undefined); // keep the stylized fallback
    return () => {
      cancelled = true;
    };
  }, []);

  const earthMaterial = useMemo(() => {
    if (!maps) return null;
    return new THREE.ShaderMaterial({
      uniforms: {
        uDay: { value: maps.day },
        uNight: { value: maps.night },
        uSun: { value: sunDir },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDay;
        uniform sampler2D uNight;
        uniform vec3 uSun;
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          float d = dot(normalize(vNormal), normalize(uSun));
          float mixv = smoothstep(-0.12, 0.12, d);
          vec3 day = texture2D(uDay, vUv).rgb;
          vec3 night = texture2D(uNight, vUv).rgb * 2.2;
          gl_FragColor = vec4(mix(night, day, mixv), 1.0);
        }
      `,
    });
  }, [maps, sunDir]);

  const atmosphereMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color("#3aa0ff") } },
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vNormal;
          uniform vec3 uColor;
          void main() {
            float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
            gl_FragColor = vec4(uColor, 1.0) * intensity;
          }
        `,
      }),
    [],
  );

  // Drive the sun: real-time terminator, or lock the lit/dark side to the camera.
  useFrame(() => {
    if (!earthMaterial) return;
    if (lighting === "realtime") {
      const { lat, lon } = subsolarPoint();
      const v = latLonToVector3(lat, lon, 1);
      sunDir.set(v.x, v.y, v.z).normalize();
    } else if (lighting === "day") {
      sunDir.copy(camera.position).normalize();
    } else {
      sunDir.copy(camera.position).normalize().multiplyScalar(-1);
    }
  });

  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        {earthMaterial ? (
          <primitive object={earthMaterial} attach="material" />
        ) : (
          <meshStandardMaterial
            color="#0b2545"
            emissive="#08203a"
            emissiveIntensity={0.5}
            metalness={0.2}
            roughness={0.7}
          />
        )}
      </mesh>

      {/* Atmosphere glow */}
      <mesh scale={1.18} material={atmosphereMaterial}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
      </mesh>
    </group>
  );
}
