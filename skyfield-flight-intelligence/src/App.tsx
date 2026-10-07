import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveFlightSource } from "./data/flightSource.js";
import { computeStats, type Flight, type FlightStats } from "./data/types.js";
import { DEFAULT_FILTER, makeFilterFn, type FlightFilter } from "./data/filter.js";
import { Scene } from "./three/Scene.js";
import {
  KpiStrip, TopCountries, FlightsTable, FlightDetails, InsightsPanel, HelpOverlay,
} from "./components/Hud.js";
import { ControlsPanel, type Settings } from "./components/ControlsPanel.js";
import { SearchPanel } from "./components/SearchPanel.js";

const EMPTY_STATS: FlightStats = {
  total: 0, airborne: 0, grounded: 0, countries: 0,
  avgAltitudeFt: 0, avgSpeedKmh: 0, topCountries: [], altitudeBins: [], manufacturers: [],
};

export default function App() {
  // Live Fabric data if a semantic-model client is injected; else sample fleet.
  const source = useMemo(() => resolveFlightSource(1200), []);
  const isLive = source.isLive;

  const [settings, setSettings] = useState<Settings>({
    count: 1200,
    planeSize: 0.035,
    speed: 1.5,
    autoRotate: true,
    showArcs: true,
    showAirports: true,
    lighting: "realtime",
    colorBy: "country",
  });
  const [filter, setFilter] = useState<FlightFilter>(DEFAULT_FILTER);
  const [selected, setSelected] = useState<Flight | null>(null);
  const [follow, setFollow] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [stats, setStats] = useState<FlightStats>(EMPTY_STATS);
  const [counts, setCounts] = useState({ shown: 0, total: 0 });
  const [countries, setCountries] = useState<string[]>([]);
  const [airlines, setAirlines] = useState<string[]>([]);
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [visibleFlights, setVisibleFlights] = useState<Flight[]>([]);

  const filterFn = useMemo(() => makeFilterFn(filter), [filter]);
  // Keep a ref so the render loop always sees the latest predicate.
  const filterRef = useRef(filterFn);
  filterRef.current = filterFn;
  const stableFilterFn = useCallback((f: Flight) => filterRef.current(f), []);

  useEffect(() => {
    source.setCount?.(settings.count);
  }, [source, settings.count]);

  useEffect(() => {
    return () => source.stop?.();
  }, [source]);

  useEffect(() => {
    const update = () => {
      const all = source.current();
      const visible = all.filter(filterFn);
      setStats(computeStats(visible));
      setCounts({ shown: visible.length, total: all.length });
      setCountries([...new Set(all.map((f) => f.originCountry))].sort());
      // Airline + maker dropdowns are scoped to the selected country (+ base
      // toggles), ignoring the airline/maker filters themselves — so picking a
      // country narrows them to that country's fleet.
      const scope = all.filter(
        (f) =>
          (!filter.country || f.originCountry === filter.country) &&
          (!filter.airborneOnly || !f.onGround) &&
          (!filter.airlinesOnly || (f.callsign != null && /^[A-Z]{3}\d/.test(f.callsign))),
      );
      setAirlines([...new Set(scope.map((f) => f.airline).filter(Boolean) as string[])].sort());
      setManufacturers(
        [...new Set(scope.map((f) => f.manufacturer).filter(Boolean) as string[])].sort(),
      );
      // Only build the table list when a country is picked (keeps it small).
      setVisibleFlights(filter.country ? visible.slice(0, 300) : []);
    };
    update();
    const id = setInterval(update, 700);
    return () => clearInterval(id);
  }, [source, filterFn, filter.country, filter.airborneOnly, filter.airlinesOnly]);

  const clearFilters = useCallback(() => {
    setFilter(DEFAULT_FILTER);
    setSelected(null);
    setFollow(false);
  }, []);

  const getFlights = useCallback(() => source.current(), [source]);
  const advance = useCallback((dt: number) => source.advance(dt), [source]);

  return (
    <div className="stage">
      <Scene
        getFlights={getFlights}
        advance={advance}
        planeSize={settings.planeSize}
        speed={settings.speed}
        autoRotate={settings.autoRotate}
        showArcs={settings.showArcs}
        showAirports={settings.showAirports}
        lighting={settings.lighting}
        colorMode={settings.colorBy}
        follow={follow}
        frameKey={filter.country}
        filterFn={stableFilterFn}
        selected={selected}
        onSelect={setSelected}
        onClearSelection={() => {
          setSelected(null);
          setFollow(false);
        }}
      />

      <KpiStrip stats={stats} isLive={isLive} onHelp={() => setHelpOpen(true)} />
      {filter.country ? (
        <FlightsTable
          country={filter.country}
          flights={visibleFlights}
          onSelect={setSelected}
          selectedIcao={selected?.icao24}
        />
      ) : (
        <TopCountries stats={stats} onPick={(c) => setFilter({ ...filter, country: c })} />
      )}
      <SearchPanel
        filter={filter}
        onChange={setFilter}
        onClear={clearFilters}
        countries={countries}
        airlines={airlines}
        manufacturers={manufacturers}
        shown={counts.shown}
        total={counts.total}
      />
      <div className="rail rail--right">
        <FlightDetails
          flight={selected}
          follow={follow}
          onToggleFollow={() => setFollow((v) => !v)}
        />
        <ControlsPanel settings={settings} onChange={setSettings} isLive={isLive} />
      </div>
      <InsightsPanel
        stats={stats}
        activeBand={filter.band}
        onBand={(b) => setFilter({ ...filter, band: filter.band === b ? "all" : b })}
        activeMaker={filter.manufacturer}
        onMaker={(m) => setFilter({ ...filter, manufacturer: filter.manufacturer === m ? "" : m })}
      />
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}

      <div className="legend">
        <span className="legend__title">Altitude</span>
        <span className="legend__ramp" />
        <span className="legend__lo">low</span>
        <span className="legend__hi">high</span>
      </div>
    </div>
  );
}
