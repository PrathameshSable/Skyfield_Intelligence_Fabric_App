// Live feed on/off switch, shown at the bottom of Controls when the app runs inside Fabric.
import { useCallback, useEffect, useState } from "react";
import { REGIONS, isActive, latestRun, startFeed, stopFeed, type FeedRun } from "../services/feed";
import { toUtcMs } from "../data/fabric/fabricProvider";
import { LIVE_WINDOW_MINUTES } from "../data/fabric/flightQueries";

const RUN_MINUTES = [15, 30, 60];
const STORE = "skyfield.feed"; // what this browser last started, to label the run (the job API doesn't say)
interface Started {
  region: string;
  minutes: number;
  at: number;
}

function readStarted(): Started | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "null") as Started | null;
  } catch {
    return null;
  }
}

function saveStarted(s: Started) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // storage blocked: the run just goes unlabelled
  }
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

/** A start/stop request from the phone remote; `n` changes with every tap. */
export interface FeedCommand {
  kind: "start" | "stop";
  n: number;
  /** Chosen on the phone; anything not on the lists falls back to what the big screen shows. */
  region?: string;
  minutes?: number;
}

export function FeedControl({
  aircraft, lastUpdate, command,
}: {
  aircraft: number;
  lastUpdate: number | null;
  command?: FeedCommand | null;
}) {
  const [run, setRun] = useState<FeedRun | null>(null);
  const [known, setKnown] = useState(false);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const [error, setError] = useState("");
  const [region, setRegion] = useState(() => readStarted()?.region ?? "europe");
  const [minutes, setMinutes] = useState(30);

  const refresh = useCallback(async () => {
    if (document.hidden) return;
    try {
      const latest = await latestRun();
      setRun(latest);
      setKnown(true);
      setError("");
      setBusy((b) => ((b === "start" && isActive(latest)) || (b === "stop" && !isActive(latest)) ? null : b));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), error ? 60_000 : busy ? 4_000 : 10_000);
    return () => clearInterval(id);
  }, [refresh, error, busy]);

  const act = async (kind: "start" | "stop", r = region, m = minutes) => {
    setBusy(kind);
    setError("");
    try {
      if (kind === "start") {
        await startFeed(r, m);
        saveStarted({ region: r, minutes: m, at: Date.now() });
      } else if (run) {
        await stopFeed(run);
      }
      await refresh();
    } catch (err) {
      setBusy(null);
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (!command || busy) return;
    // Start only when the feed is known to be off, so a second tap can't begin a second notebook run.
    if (command.kind === "start" && known && !isActive(run)) {
      const r = REGIONS.some((x) => x.id === command.region) ? command.region! : region;
      const m = RUN_MINUTES.includes(command.minutes ?? 0) ? command.minutes! : minutes;
      setRegion(r); // the big screen shows what the phone picked
      setMinutes(m);
      void act("start", r, m);
    }
    if (command.kind === "stop" && isActive(run)) void act("stop");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per tap, not on every status poll
  }, [command]);

  const now = Date.now();
  const active = isActive(run);
  const runStart = run?.startTimeUtc ? toUtcMs(run.startTimeUtc.slice(0, 23)) : null;
  const started = readStarted();
  // label the run only if this browser started it (within a few minutes of the run's start)
  const mine = started && runStart && Math.abs(started.at - runStart) < 5 * 60_000 ? started : null;
  const fresh = active && lastUpdate != null && runStart != null && lastUpdate >= runStart;
  const regionLabel = REGIONS.find((r) => r.id === mine?.region)?.label;

  let state: "off" | "starting" | "on" = "off";
  let title = "Feed off";
  let detail = lastUpdate
    ? `Last data ${ago(now - lastUpdate)}`
    : known ? `No aircraft in the last ${LIVE_WINDOW_MINUTES} min` : error ? "Feed status unavailable" : "Checking the feed…";
  if (busy === "stop") {
    title = "Stopping the feed…";
  } else if (fresh) {
    state = "on";
    const left = mine && runStart ? Math.ceil((runStart + mine.minutes * 60_000 - now) / 60_000) : null;
    // Time left sits in the title so the detail stays on one line: a third line pushed Controls into a scrollbar.
    title = `Live${regionLabel ? ` · ${regionLabel}` : ""}${left != null && left > 0 ? ` · ${left} min left` : ""}`;
    detail = `${aircraft.toLocaleString()} aircraft · updated ${ago(now - lastUpdate!)}`;
  } else if (active || busy === "start") {
    state = "starting";
    title = "Starting the feed…";
    detail = "Fabric takes 1–3 min to start the notebook";
  }

  return (
    <div className="feed">
      <div className="feed__status">
        <span className={`feed__dot feed__dot--${state}`} />
        <div className="feed__text">
          <b>{title}</b>
          <span>{detail}</span>
        </div>
      </div>
      {active || busy ? (
        <button className="band feed__btn" onClick={() => act("stop")} disabled={!active || busy === "stop"}>
          Stop feed
        </button>
      ) : (
        <div className="feed__start">
          <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Run for">
            {RUN_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <button className="band band--on feed__btn" onClick={() => act("start")}>
            Start
          </button>
        </div>
      )}
      {error && <p className="feed__error">{error}</p>}
      <a className="feed__credit" href="https://adsb.fi" target="_blank" rel="noreferrer">
        Aircraft data: adsb.fi
      </a>
    </div>
  );
}
