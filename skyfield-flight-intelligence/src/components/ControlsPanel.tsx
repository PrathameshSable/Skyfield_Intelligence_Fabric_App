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

interface ControlsPanelProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  isLive: boolean;
}

export function ControlsPanel({ settings, onChange, isLive }: ControlsPanelProps) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div className="panel panel--controls">
      <div className="panel__title">Controls</div>

      {!isLive && (
        <label className="ctl">
          <span>Aircraft <em>{settings.count.toLocaleString()}</em></span>
          <input
            type="range" min={100} max={6000} step={100}
            value={settings.count}
            onChange={(e) => set("count", Number(e.target.value))}
          />
        </label>
      )}

      <label className="ctl">
        <span>Animation speed <em>{settings.speed.toFixed(1)}×</em></span>
        <input
          type="range" min={0} max={6} step={0.5}
          value={settings.speed}
          onChange={(e) => set("speed", Number(e.target.value))}
        />
      </label>

      <label className="ctl">
        <span>Marker size <em>{settings.planeSize.toFixed(2)}</em></span>
        <input
          type="range" min={0.02} max={0.12} step={0.005}
          value={settings.planeSize}
          onChange={(e) => set("planeSize", Number(e.target.value))}
        />
      </label>

      <div className="ctl">
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

      <div className="ctl">
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

      <label className="ctl ctl--row">
        <span>Flight paths</span>
        <input
          type="checkbox"
          checked={settings.showArcs}
          onChange={(e) => set("showArcs", e.target.checked)}
        />
      </label>

      <label className="ctl ctl--row">
        <span>Airports</span>
        <input
          type="checkbox"
          checked={settings.showAirports}
          onChange={(e) => set("showAirports", e.target.checked)}
        />
      </label>

      <label className="ctl ctl--row">
        <span>Auto-orbit</span>
        <input
          type="checkbox"
          checked={settings.autoRotate}
          onChange={(e) => set("autoRotate", e.target.checked)}
        />
      </label>

      <div className="source-tag">{isLive ? "● LIVE · Fabric" : "● DEMO · sample data"}</div>
    </div>
  );
}
