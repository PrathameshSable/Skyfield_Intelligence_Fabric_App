import type { Flight, FlightStats } from "../data/types.js";
import type { AltitudeBand } from "../data/filter.js";

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`kpi${accent ? " kpi--accent" : ""}`}>
      <div className="kpi__value">{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  );
}

export function KpiStrip({
  stats, isLive, onHelp,
}: {
  stats: FlightStats;
  isLive: boolean;
  onHelp: () => void;
}) {
  return (
    <div className="hud hud--top">
      <div className="brand">
        <span className={`brand__dot${isLive ? " brand__dot--live" : ""}`} />
        SKYFIELD
        <span className="brand__sub">{isLive ? "live · fabric" : "demo · sample"}</span>
        {isLive && <span className="live-badge">● LIVE</span>}
        <button className="brand-help" onClick={onHelp} title="What am I looking at?">
          ?
        </button>
      </div>
      <div className="kpi-row">
        <Kpi label="Aircraft tracked" value={stats.total.toLocaleString()} accent />
        <Kpi label="Airborne" value={stats.airborne.toLocaleString()} />
        <Kpi label="On ground" value={stats.grounded.toLocaleString()} />
        <Kpi label="Countries" value={stats.countries.toLocaleString()} />
        <Kpi label="Avg altitude" value={`${Math.round(stats.avgAltitudeFt).toLocaleString()} ft`} />
        <Kpi label="Avg speed" value={`${Math.round(stats.avgSpeedKmh)} km/h`} />
      </div>
    </div>
  );
}

// The 5 altitude bins map onto the 3 filter bands.
const BIN_BAND: AltitudeBand[] = ["low", "mid", "mid", "high", "high"];

interface InsightsProps {
  stats: FlightStats;
  activeBand: AltitudeBand;
  onBand: (b: AltitudeBand) => void;
  activeMaker: string;
  onMaker: (m: string) => void;
}

export function InsightsPanel({ stats, activeBand, onBand, activeMaker, onMaker }: InsightsProps) {
  const altMax = Math.max(1, ...stats.altitudeBins.map((b) => b.count));
  const mkMax = Math.max(1, ...stats.manufacturers.map((m) => m.count));
  return (
    <div className="panel panel--insights">
      <div className="insights-col">
        <div className="panel__title">Altitude · click to filter</div>
        <div className="altbars">
          {stats.altitudeBins.map((b, i) => {
            const band = BIN_BAND[i]!;
            return (
              <button
                key={b.label}
                className={`altbar${activeBand === band ? " altbar--on" : ""}`}
                onClick={() => onBand(band)}
              >
                <span className="altbar__col">
                  <span className="altbar__fill" style={{ height: `${(b.count / altMax) * 100}%` }} />
                </span>
                <span className="altbar__n">{b.count}</span>
                <span className="altbar__label">{b.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="insights-div" />

      <div className="insights-col">
        <div className="panel__title">Aircraft makers · click to filter</div>
        <ul className="mk-bars">
          {stats.manufacturers.length === 0 && <li className="hint">no data yet</li>}
          {stats.manufacturers.map((m) => (
            <li key={m.name}>
              <button
                className={`mk-row${activeMaker === m.name ? " mk-row--on" : ""}`}
                onClick={() => onMaker(m.name)}
              >
                <span className="mk-name">{m.name}</span>
                <span className="mk-track">
                  <span className="mk-fill" style={{ width: `${(m.count / mkMax) * 100}%` }} />
                </span>
                <span className="mk-count">{m.count}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const HELP_ITEMS: [string, string][] = [
  ["The globe", "Real Earth with a live day/night terminator. Each glyph is a live aircraft, nose pointed along its heading, colored by country (or altitude)."],
  ["Flight paths", "Glowing great-circle arcs from origin → destination airport. Select a flight and only its route stays."],
  ["Airports", "Dots at every route endpoint; size + heat colour = how busy. Labels on the busiest. Toggle in Controls."],
  ["KPI strip (top)", "Live totals — aircraft tracked, airborne, on-ground, countries, average altitude and speed."],
  ["Busiest airspace / Flights table", "Top countries by traffic. Pick a country → its flights with origin→destination; click a row to focus that flight."],
  ["Search & filter", "Find by callsign / country / ICAO24, or slice by country, airline, aircraft maker, altitude, airborne-only and airlines-only."],
  ["Altitude profile (bottom)", "Aircraft by altitude band. Click a bar to filter the whole view to that band."],
  ["Aircraft makers (bottom)", "Boeing vs Airbus vs … split. Click a maker to filter to its fleet."],
  ["Controls", "Animation speed, marker size, colour-by (country/altitude), lighting (real-time/day/night), and toggles for flight paths, airports and auto-orbit."],
  ["Aircraft detail", "Click any plane: route, airline, aircraft type, position, altitude, speed, heading, climb/descent — and Follow to track it."],
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <div className="help-head">
          <span>What am I looking at?</span>
          <button className="help-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="help-grid">
          {HELP_ITEMS.map(([t, d]) => (
            <div className="help-item" key={t}>
              <b>{t}</b>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface FlightsTableProps {
  country: string;
  flights: Flight[];
  onSelect: (f: Flight) => void;
  selectedIcao?: string;
}

export function FlightsTable({ country, flights, onSelect, selectedIcao }: FlightsTableProps) {
  // Show flights that have a known route first.
  const sorted = [...flights].sort(
    (a, b) => Number(Boolean(b.originIata)) - Number(Boolean(a.originIata)),
  );
  const withRoute = flights.filter((f) => f.originIata).length;
  return (
    <div className="panel panel--table">
      <div className="panel__title">
        {country} · {flights.length} flights · {withRoute} routed
      </div>
      <div className="flights-list">
        {sorted.length === 0 && <p className="hint">No matching flights right now.</p>}
        {sorted.map((f) => {
          const hasR = f.originIata && f.destIata;
          const alt = f.geoAltitude != null ? `${Math.round((f.geoAltitude * 3.28084) / 1000)}k` : "—";
          return (
            <button
              key={f.icao24}
              className={`flight-row${selectedIcao === f.icao24 ? " flight-row--on" : ""}`}
              onClick={() => onSelect(f)}
              title={hasR ? `${f.originIata} → ${f.destIata}` : "route pending"}
            >
              <span className="fr-cs">{f.callsign ?? f.icao24}</span>
              <span className={`fr-route${hasR ? "" : " fr-route--none"}`}>
                {hasR ? `${f.originIata} → ${f.destIata}` : "route pending…"}
              </span>
              <span className="fr-alt">{alt}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TopCountries({
  stats,
  onPick,
}: {
  stats: FlightStats;
  onPick: (country: string) => void;
}) {
  const max = stats.topCountries[0]?.count ?? 1;
  return (
    <div className="panel panel--left">
      <div className="panel__title">Busiest airspace · click to filter</div>
      <ul className="bars">
        {stats.topCountries.map((c) => (
          <li key={c.country}>
            <button className="bars__row" onClick={() => onPick(c.country)}>
              <span className="bars__label">{c.country}</span>
              <span className="bars__track">
                <span className="bars__fill" style={{ width: `${(c.count / max) * 100}%` }} />
              </span>
              <span className="bars__count">{c.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FlightDetailsProps {
  flight: Flight | null;
  follow: boolean;
  onToggleFollow: () => void;
}

export function FlightDetails({ flight, follow, onToggleFollow }: FlightDetailsProps) {
  if (!flight) {
    return (
      <div className="panel panel--right panel--muted">
        <div className="panel__title">Aircraft detail</div>
        <p className="hint">Click an aircraft to inspect its live telemetry.</p>
      </div>
    );
  }
  const alt = flight.geoAltitude != null ? `${Math.round(flight.geoAltitude * 3.28084).toLocaleString()} ft` : "—";
  const spd = flight.velocity != null ? `${Math.round(flight.velocity * 3.6)} km/h` : "—";
  const vr = flight.verticalRate;
  const trend = vr == null ? "level" : vr > 0.5 ? "climbing" : vr < -0.5 ? "descending" : "cruising";
  const route =
    flight.originIata && flight.destIata ? `${flight.originIata} → ${flight.destIata}` : null;
  return (
    <div className="panel panel--right">
      <div className="panel__head">
        <div className="panel__title">{flight.callsign ?? flight.icao24}</div>
        <button className={`follow-btn${follow ? " follow-btn--on" : ""}`} onClick={onToggleFollow}>
          {follow ? "● Following" : "Follow"}
        </button>
      </div>
      <div className="detail-grid">
        {route && <><span>Route</span><b className="route">{route}</b></>}
        {flight.airline && <><span>Airline</span><b>{flight.airline}</b></>}
        {flight.aircraftType && <><span>Aircraft</span><b>{flight.aircraftType}</b></>}
        <span>Origin</span><b>{flight.originCountry}</b>
        <span>ICAO24</span><b>{flight.icao24}</b>
        <span>Position</span><b>{flight.latitude.toFixed(2)}°, {flight.longitude.toFixed(2)}°</b>
        <span>Altitude</span><b>{alt}</b>
        <span>Ground speed</span><b>{spd}</b>
        <span>Heading</span><b>{flight.heading != null ? `${Math.round(flight.heading)}°` : "—"}</b>
        <span>State</span><b className={`state state--${trend}`}>{flight.onGround ? "on ground" : trend}</b>
      </div>
    </div>
  );
}
