import type { ReactNode } from "react";
import type { LightingMode } from "../three/Globe.js";
import type { ColorMode } from "../lib/geo.js";

export interface Settings {
  count: number;
  planeSize: number;
  speed: number;
  autoRotate: boolean;
  showArcs: boolean;
  showAirports: boolean;
  lighting: LightingMode;
  colorBy: ColorMode;
}

const LIGHTING: { id: LightingMode; label: string }[] = [
  { id: "realtime", label: "Auto" },
  { id: "day", label: "Day" },
  { id: "night", label: "Night" },
];

const COLOR_BY: { id: ColorMode; label: string }[] = [
  { id: "country", label: "Country" },
  { id: "altitude", label: "Altitude" },
];

const TOGGLES: { key: "showArcs" | "showAirports" | "autoRotate"; label: string }[] = [
  { key: "showArcs", label: "Paths" },
  { key: "showAirports", label: "Airports" },
  { key: "autoRotate", label: "Orbit" },
];

interface ControlsPanelProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  isLive: boolean;
  /** Live feed switch; replaces the source tag when given. */
  feed?: ReactNode;
}

export function ControlsPanel({ settings, onChange, isLive, feed }: ControlsPanelProps) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div className="panel panel--controls">
      <div className="panel__title">Controls</div>

      {!isLive && (
        <label className="ctl ctl--slider">
          <span>Aircraft</span>
          <em>{settings.count.toLocaleString()}</em>
          <input
            type="range" min={100} max={6000} step={100}
            value={settings.count}
            onChange={(e) => set("count", Number(e.target.value))}
          />
        </label>
      )}

      {!isLive && (
      <label className="ctl ctl--slider">
        <span>Speed</span>
        <em>{settings.speed.toFixed(1)}×</em>
        <input
          type="range" min={0} max={6} step={0.5}
          value={settings.speed}
          onChange={(e) => set("speed", Number(e.target.value))}
        />
      </label>
      )}

      <label className="ctl ctl--slider">
        <span>Markers</span>
          <em>{settings.planeSize.toFixed(2)}</em>
        <input
          type="range" min={0.02} max={0.12} step={0.005}
          value={settings.planeSize}
          onChange={(e) => set("planeSize", Number(e.target.value))}
        />
      </label>

      <div className="ctl ctl--inline">
        <span>Color by</span>
        <div className="band-row">
          {COLOR_BY.map((c) => (
            <button
              key={c.id}
              className={`band${settings.colorBy === c.id ? " band--on" : ""}`}
              onClick={() => set("colorBy", c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ctl ctl--inline">
        <span>Lighting</span>
        <div className="band-row">
          {LIGHTING.map((l) => (
            <button
              key={l.id}
              className={`band${settings.lighting === l.id ? " band--on" : ""}`}
              onClick={() => set("lighting", l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ctl ctl--inline">
        <span>Show</span>
        <div className="band-row">
          {TOGGLES.map((t) => (
            <button
              key={t.key}
              className={`band${settings[t.key] ? " band--on" : ""}`}
              aria-pressed={settings[t.key]}
              onClick={() => set(t.key, !settings[t.key])}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {feed ?? <div className="source-tag">{isLive ? "● LIVE · Fabric" : "● DEMO · sample data"}</div>}
    </div>
  );
}
