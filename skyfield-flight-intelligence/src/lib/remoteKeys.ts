/** Key map for driving the demo from a phone paired as a Bluetooth keyboard. */
export type RemoteAction =
  | "nextCountry" | "prevCountry" | "nextFlight" | "prevFlight"
  | "follow" | "orbit" | "zoomIn" | "zoomOut" | "tour" | "clean"
  | "lighting" | "colorBy" | "paths" | "airports" | "help" | "reset"
  // Phone page only. Deliberately not on a key: a stray key press must not start a notebook run.
  | "feedStart" | "feedStop"
  // Phone page only: filters. "band" and "maker" carry an argument (band:low, maker:next).
  | "band" | "maker" | "airborne" | "airlinesOnly";

const KEYS = new Map<string, RemoteAction>([
  ["ArrowRight", "nextCountry"], ["ArrowLeft", "prevCountry"],
  ["ArrowDown", "nextFlight"], ["ArrowUp", "prevFlight"],
  ["Enter", "follow"], [" ", "orbit"],
  ["+", "zoomIn"], ["=", "zoomIn"], ["PageUp", "zoomIn"],
  ["-", "zoomOut"], ["_", "zoomOut"], ["PageDown", "zoomOut"],
  ["t", "tour"], ["f", "clean"], ["l", "lighting"], ["c", "colorBy"],
  ["p", "paths"], ["a", "airports"], ["h", "help"],
  ["Escape", "reset"],
]);

const ACTIONS = new Set<string>([
  ...KEYS.values(), "feedStart", "feedStop", "band", "maker", "airborne", "airlinesOnly",
]);

/** Guards action names that arrive from outside (the phone remote). */
export function isRemoteAction(value: unknown): value is RemoteAction {
  return typeof value === "string" && ACTIONS.has(value);
}

export function keyToAction(key: string): RemoteAction | undefined {
  return KEYS.get(key.length === 1 ? key.toLowerCase() : key);
}

/** Next index with wrap-around; from "nothing selected" (-1) forward lands on the first, back on the last. */
export function step(length: number, index: number, dir: 1 | -1): number {
  if (length === 0) return -1;
  if (index < 0) return dir === 1 ? 0 : length - 1;
  return (index + dir + length) % length;
}
