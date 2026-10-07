import { isFilterActive, type AltitudeBand, type FlightFilter } from "../data/filter.js";

interface SearchPanelProps {
  filter: FlightFilter;
  onChange: (next: FlightFilter) => void;
  onClear: () => void;
  countries: string[];
  airlines: string[];
  manufacturers: string[];
  shown: number;
  total: number;
}

const BANDS: { id: AltitudeBand; label: string }[] = [
  { id: "all", label: "All" },
  { id: "low", label: "Low" },
  { id: "mid", label: "Mid" },
  { id: "high", label: "High" },
];

export function SearchPanel({
  filter, onChange, onClear, countries, airlines, manufacturers, shown, total,
}: SearchPanelProps) {
  return (
    <div className="panel panel--search">
      <div className="panel__title">Search &amp; filter</div>

      <input
        className="search-input"
        type="text"
        placeholder="Callsign, country, ICAO24…"
        value={filter.text}
        onChange={(e) => onChange({ ...filter, text: e.target.value })}
      />

      <div className="slicer">
        <select
          className="search-input search-select"
          value={filter.country}
          onChange={(e) => onChange({ ...filter, country: e.target.value })}
        >
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {filter.country && (
          <button className="slicer-x" title="Clear country" onClick={() => onChange({ ...filter, country: "" })}>
            ✕
          </button>
        )}
      </div>

      <div className="slicer">
        <select
          className="search-input search-select"
          value={filter.airline}
          onChange={(e) => onChange({ ...filter, airline: e.target.value })}
        >
          <option value="">All airlines</option>
          {airlines.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {filter.airline && (
          <button className="slicer-x" title="Clear airline" onClick={() => onChange({ ...filter, airline: "" })}>
            ✕
          </button>
        )}
      </div>

      <div className="slicer">
        <select
          className="search-input search-select"
          value={filter.manufacturer}
          onChange={(e) => onChange({ ...filter, manufacturer: e.target.value })}
        >
          <option value="">All aircraft makers</option>
          {manufacturers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {filter.manufacturer && (
          <button className="slicer-x" title="Clear maker" onClick={() => onChange({ ...filter, manufacturer: "" })}>
            ✕
          </button>
        )}
      </div>

      <div className="band-row">
        {BANDS.map((b) => (
          <button
            key={b.id}
            className={`band${filter.band === b.id ? " band--on" : ""}`}
            onClick={() => onChange({ ...filter, band: b.id })}
          >
            {b.label}
          </button>
        ))}
      </div>

      <label className="ctl ctl--row">
        <span>Airborne only</span>
        <input
          type="checkbox"
          checked={filter.airborneOnly}
          onChange={(e) => onChange({ ...filter, airborneOnly: e.target.checked })}
        />
      </label>

      <label className="ctl ctl--row">
        <span>Airlines only</span>
        <input
          type="checkbox"
          checked={filter.airlinesOnly}
          onChange={(e) => onChange({ ...filter, airlinesOnly: e.target.checked })}
        />
      </label>

      <div className="search-foot">
        <span className="shown-tag">
          Showing <b>{shown.toLocaleString()}</b> of {total.toLocaleString()}
        </span>
        {isFilterActive(filter) && (
          <button className="clear-btn" onClick={onClear}>
            ✕ Clear
          </button>
        )}
      </div>
    </div>
  );
}
