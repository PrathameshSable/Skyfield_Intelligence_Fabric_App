// The live feed's on/off switch: Start runs the `opensky_to_eventstream` notebook (now an adsb.fi feed) through the
// Fabric job API with a region and a run length; Stop cancels that run. The notebook also stops by itself.
import { getFabricClient } from "@/lib/fabric-client";
import { getFabricToken } from "./msal";

const WORKSPACE_ID = "69cb4790-1cc3-43cb-8904-1f115e71dfdd"; // Fabric Apps Demos
const NOTEBOOK_ID = "ac367965-c6f2-4ad4-a34e-dfa0551e29d1"; // opensky_to_eventstream
const JOBS = `https://api.fabric.microsoft.com/v1/workspaces/${WORKSPACE_ID}/items/${NOTEBOOK_ID}/jobs/instances`;

/** Keys must match REGIONS in the notebook. */
export const REGIONS = [
  { id: "europe", label: "Europe" },
  { id: "uk", label: "UK & Ireland" },
  { id: "us_east", label: "US East" },
  { id: "gulf", label: "Gulf" },
  { id: "india", label: "India" },
] as const;

export interface FeedRun {
  id: string;
  status: string; // NotStarted | InProgress | Deduping | Completed | Failed | Cancelled
  startTimeUtc: string | null;
  endTimeUtc: string | null;
}

export const isActive = (run: FeedRun | null) => !!run && ["NotStarted", "InProgress", "Deduping"].includes(run.status);

let upn: Promise<string | undefined> | null = null;

/** The Fabric user's UPN, from the semantic model (USERPRINCIPALNAME), so sign-in picks the right account. */
function fabricUser(): Promise<string | undefined> {
  // the host may never answer (throttled capacity, or no host at all): sign in without a hint after 15 s
  const giveUp = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 15_000));
  upn ??= Promise.race([
    getFabricClient()
      .semanticModel("flightsModel")
      .query('EVALUATE ROW("upn", USERPRINCIPALNAME())')
      .then((r) => (r.status === "success" ? String(r.table.rows[0]?.[0] ?? "") || undefined : undefined))
      .catch(() => undefined),
    giveUp,
  ]);
  return upn;
}

async function call(url: string, init?: RequestInit): Promise<Response> {
  const token = await getFabricToken(await fabricUser());
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("You need Contributor access to the Fabric Apps Demos workspace to run the feed.");
  }
  return res;
}

/** The newest run of the feed notebook, or null if it never ran. */
export async function latestRun(): Promise<FeedRun | null> {
  const res = await call(`${JOBS}?maxResults=1`);
  if (!res.ok) throw new Error(`Fabric did not list the feed runs (${res.status}).`);
  return ((await res.json()).value?.[0] as FeedRun | undefined) ?? null;
}

export async function startFeed(region: string, minutes: number): Promise<void> {
  if (isActive(await latestRun())) return; // two runs would send every aircraft twice
  const res = await call(`${JOBS}?jobType=RunNotebook`, {
    method: "POST",
    body: JSON.stringify({
      executionData: {
        parameters: {
          region: { value: region, type: "string" },
          run_minutes: { value: String(minutes), type: "int" },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`Fabric did not start the feed notebook (${res.status}).`);
}

export async function stopFeed(run: FeedRun): Promise<void> {
  const res = await call(`${JOBS}/${run.id}/cancel`, { method: "POST" });
  if (!res.ok && res.status !== 409) throw new Error(`Fabric did not stop the feed (${res.status}).`); // 409: already ended
}
