import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveFlightSource } from "./data/flightSource.js";
import { computeStats, hasRoute, type Flight, type FlightStats } from "./data/types.js";
import { byRouteThenCallsign, DEFAULT_FILTER, makeFilterFn, type FlightFilter } from "./data/filter.js";
import { keyToAction, step, type RemoteAction } from "./lib/remoteKeys.js";
import { listenForRemote, newRemoteCode, REMOTE_ENABLED } from "./services/remoteLink.js";
import { RemotePanel } from "./components/RemotePanel.js";
import { Scene, type ZoomRequest } from "./three/Scene.js";
import {
  KpiStrip, TopCountries, FlightsTable, FlightDetails, InsightsPanel, HelpOverlay,
} from "./components/Hud.js";
import { ControlsPanel, type Settings } from "./components/ControlsPanel.js";
import { SearchPanel } from "./components/SearchPanel.js";
import { FeedControl, type FeedCommand } from "./components/FeedControl.js";

const EMPTY_STATS: FlightStats = {
  total: 0, airborne: 0, grounded: 0, countries: 0,
  avgAltitudeFt: 0, avgSpeedKmh: 0, topCountries: [], altitudeBins: [], manufacturers: [],
};

const LIGHTING_ORDER: Settings["lighting"][] = ["realtime", "day", "night"];
const TOUR_HOP_MS = 8000;
/** Remote keys that leave a running auto tour going. */
const TOUR_SAFE = new Set(["tour", "zoomIn", "zoomOut", "clean", "feedStart", "feedStop"]);

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
  const [counts, setCounts] = useState({ shown: 0, total: 0, routed: 0 });
  const [countries, setCountries] = useState<string[]>([]);
  const [airlines, setAirlines] = useState<string[]>([]);
  const [manufacturers, setManufacturers] = useState<string[]>([]);
  const [visibleFlights, setVisibleFlights] = useState<Flight[]>([]);

  const filterFn = useMemo(() => makeFilterFn(filter), [filter]);
  // Keep a ref so the render loop always sees the latest predicate.
  const filterRef = useRef(filterFn);
  // While a flight is being followed, the globe shows that aircraft alone (panels keep the full list).
  filterRef.current = follow && selected ? (f) => f.icao24 === selected.icao24 : filterFn;
  const stableFilterFn = useCallback((f: Flight) => filterRef.current(f), []);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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
      setCounts({
        shown: visible.length,
        total: all.length,
        routed: visible.filter((f) => f.originIata).length,
      });
      // Each live poll brings new flight objects: keep the selection on the fresh one, so its ring and
      // detail panel follow the plane instead of freezing at the moment it was picked.
      const picked = selectedRef.current;
      if (picked) {
        const fresh = all.find((f) => f.icao24 === picked.icao24);
        if (fresh) {
          setSelected(fresh);
        } else {
          // It left the data (landed, flew out of the region, or the feed stopped). Let go of it, or a
          // followed plane would leave an empty globe with a ring frozen at its last position.
          setSelected(null);
          setFollow(false);
        }
      }
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
      // Sorted before the cut, so the same flights stay listed; the remote's ↑/↓ walk this same order.
      setVisibleFlights(filter.country ? [...visible].sort(byRouteThenCallsign).slice(0, 300) : []);
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

  // ── Phone remote: a phone paired as a Bluetooth keyboard drives the demo ──
  const [tour, setTour] = useState(false);
  const [clean, setClean] = useState(false);
  const zoomRef = useRef<ZoomRequest>({ steps: 0, home: false });
  const [feedCommand, setFeedCommand] = useState<FeedCommand | null>(null);
  // The busiest countries, remembered from the unfiltered view (a country filter narrows stats to one).
  const topRef = useRef<string[]>([]);
  if (!filter.country && stats.topCountries.length) {
    topRef.current = stats.topCountries.map((c) => c.country);
  }
  // Same idea for aircraft makers, for the phone's maker filter.
  const makersRef = useRef<string[]>([]);
  if (!filter.manufacturer && stats.manufacturers.length) {
    makersRef.current = stats.manufacturers.map((m) => m.name);
  }
  const remote = useRef({ filter, selected, visibleFlights });
  remote.current = { filter, selected, visibleFlights };

  const goCountry = useCallback((dir: 1 | -1) => {
    const list = topRef.current;
    const country = list[step(list.length, list.indexOf(remote.current.filter.country), dir)];
    if (!country) return undefined;
    setFilter({ ...DEFAULT_FILTER, country });
    setSelected(null);
    setFollow(false);
    return country;
  }, []);

  useEffect(() => {
    if (!tour) return;
    const hop = () => {
      const country = goCountry(1);
      if (!country) return;
      const airborne = source.current().filter((f) => f.originCountry === country && !f.onGround);
      const pick = airborne.find((f) => hasRoute(f)) ?? airborne[0];
      if (pick) {
        setSelected(pick);
        setFollow(true);
      }
    };
    hop();
    const id = setInterval(hop, TOUR_HOP_MS);
    return () => clearInterval(id);
  }, [tour, goCountry, source]);

  /** One place for every remote action, whether it comes from a key or from the phone page. */
  const runAction = useCallback(
    (action: RemoteAction, args: string[] = []) => {
      if (!TOUR_SAFE.has(action)) setTour(false);
      const toggle = (key: "autoRotate" | "showArcs" | "showAirports") =>
        setSettings((s) => ({ ...s, [key]: !s[key] }));
      const goFlight = (dir: 1 | -1) => {
        const { selected: sel, visibleFlights: list } = remote.current;
        const next = list[step(list.length, list.findIndex((f) => f.icao24 === sel?.icao24), dir)];
        if (next) setSelected(next);
      };
      switch (action) {
        case "nextCountry": goCountry(1); break;
        case "prevCountry": goCountry(-1); break;
        case "nextFlight": goFlight(1); break;
        case "prevFlight": goFlight(-1); break;
        case "follow": if (remote.current.selected) setFollow((v) => !v); break;
        case "orbit": toggle("autoRotate"); break;
        case "zoomIn": zoomRef.current.steps += 1; break;
        case "zoomOut": zoomRef.current.steps -= 1; break;
        case "tour": setTour((v) => !v); break;
        case "clean": setClean((v) => !v); break;
        case "lighting":
          setSettings((s) => ({
            ...s,
            lighting: LIGHTING_ORDER[step(LIGHTING_ORDER.length, LIGHTING_ORDER.indexOf(s.lighting), 1)]!,
          }));
          break;
        case "colorBy":
          setSettings((s) => ({ ...s, colorBy: s.colorBy === "country" ? "altitude" : "country" }));
          break;
        case "paths": toggle("showArcs"); break;
        case "airports": toggle("showAirports"); break;
        case "help": setHelpOpen((v) => !v); break;
        case "feedStart":
          setFeedCommand({ kind: "start", n: Date.now(), region: args[0], minutes: Number(args[1]) });
          break;
        case "band": {
          const band = args[0];
          if (band === "all" || band === "low" || band === "mid" || band === "high") {
            setFilter((f) => ({ ...f, band }));
          }
          break;
        }
        case "maker": {
          const list = makersRef.current;
          const at = list.indexOf(remote.current.filter.manufacturer);
          const name = args[0] === "all" ? "" : list[step(list.length, at, args[0] === "prev" ? -1 : 1)];
          if (name != null) setFilter((f) => ({ ...f, manufacturer: name }));
          break;
        }
        case "airborne": setFilter((f) => ({ ...f, airborneOnly: !f.airborneOnly })); break;
        case "airlinesOnly": setFilter((f) => ({ ...f, airlinesOnly: !f.airlinesOnly })); break;
        case "feedStop": setFeedCommand({ kind: "stop", n: Date.now() }); break;
        case "reset":
          clearFilters();
          setHelpOpen(false);
          setClean(false);
          zoomRef.current.home = true;
          break;
      }
    },
    [goCountry, clearFilters],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // The search box and dropdowns keep their own keys.
      if (e.target instanceof Element && e.target.matches("select, textarea, input[type=text]")) return;
      const action = keyToAction(e.key);
      if (!action) return;
      e.preventDefault();
      runAction(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runAction]);

  // ── Phone remote page: scan the QR, tap buttons on the phone ──
  const [remoteCode, setRemoteCode] = useState<string | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteOnline, setRemoteOnline] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!remoteCode) return;
    const disconnect = listenForRemote(
      remoteCode,
      (action, args) => {
        setRemoteOpen(false);
        runAction(action, args);
      },
      setRemoteOnline,
      setRemoteUrl,
    );
    return () => {
      disconnect();
      setRemoteOnline(false);
    };
  }, [remoteCode, runAction]);

  return (
    <div className={`stage${clean ? " stage--clean" : ""}`}>
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
        zoom={zoomRef}
        frameKey={filter.country}
        filterFn={stableFilterFn}
        selected={selected}
        onSelect={setSelected}
        onClearSelection={() => {
          setSelected(null);
          setFollow(false);
        }}
      />

      <KpiStrip
        stats={stats}
        isLive={isLive}
        onHelp={() => setHelpOpen(true)}
        onRemote={
          REMOTE_ENABLED
            ? () => {
                setRemoteCode((code) => code ?? newRemoteCode());
                setRemoteOpen(true);
              }
            : undefined
        }
      />
      {filter.country ? (
        <FlightsTable
          country={filter.country}
          flights={visibleFlights}
          total={counts.shown}
          routed={counts.routed}
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
        <ControlsPanel
          settings={settings}
          onChange={setSettings}
          isLive={isLive}
          feed={isLive ? <FeedControl aircraft={counts.total} lastUpdate={source.lastUpdate?.() ?? null} command={feedCommand} /> : undefined}
        />
      </div>
      <InsightsPanel
        stats={stats}
        activeBand={filter.band}
        onBand={(b) => setFilter({ ...filter, band: filter.band === b ? "all" : b })}
        activeMaker={filter.manufacturer}
        onMaker={(m) => setFilter({ ...filter, manufacturer: filter.manufacturer === m ? "" : m })}
      />
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      {remoteOpen && remoteCode && (
        <RemotePanel
          url={remoteUrl}
          online={remoteOnline}
          onClose={() => setRemoteOpen(false)}
          onDisconnect={() => {
            setRemoteCode(null);
            setRemoteOpen(false);
          }}
        />
      )}

      <div className="legend">
        <span className="legend__title">Altitude</span>
        <span className="legend__ramp" />
        <span className="legend__lo">low</span>
        <span className="legend__hi">high</span>
      </div>
    </div>
  );
}
