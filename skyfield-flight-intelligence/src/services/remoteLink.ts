// Phone remote link over Azure Queue Storage. Each remote session gets its own queue: the phone page
// (public/remote.html) adds one message per tap and this screen reads the queue. The QR code carries a pass
// (a SAS: a signed, expiring address) that can only add messages to that one queue.
import { isRemoteAction, type RemoteAction } from "../lib/remoteKeys.js";

const ACCOUNT: string | undefined = import.meta.env.VITE_REMOTE_ACCOUNT;
// shortcut: the account key ships inside the app bundle so the screen can sign passes without a server. The bundle
// is only served to signed-in Fabric users and the account holds nothing but tap queues; move signing to a
// server (or Entra) if this app ever leaves demo use.
const KEY: string | undefined = import.meta.env.VITE_REMOTE_KEY;

/** The phone remote is offered only when the storage account and a public page address are configured. */
export const REMOTE_ENABLED: boolean =
  Boolean(ACCOUNT && KEY) && (Boolean(import.meta.env.VITE_REMOTE_URL) || import.meta.env.DEV);

const SAS_VERSION = "2020-12-06";
const PHONE_PASS_HOURS = 6;
// shortcut: the queue is polled, so a tap lands up to POLL_MS late; a push service would be instant.
const POLL_MS = 700;
const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

/** The code names the session's queue. It is long and random, and never reused across page loads. */
export function newRemoteCode(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(12)),
    (b) => CODE_CHARS[b % CODE_CHARS.length],
  ).join("");
}

/** "action" or "action:arg:arg" -> the action and its arguments, or null for anything unknown. */
export function parseRemoteMessage(text: string): [RemoteAction, string[]] | null {
  const [action, ...args] = text.trim().split(":");
  // Anyone holding a pass can post, so only known action names get through; receivers validate the arguments.
  return isRemoteAction(action) ? [action, args] : null;
}

const sasTime = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

/** Base64 HMAC-SHA256 of `text` with a base64 key: the signature Azure Storage expects on a SAS. */
export async function sign(text: string, keyBase64: string): Promise<string> {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...mac));
}

/** Pass for the phone: add messages to this one queue only (service SAS, permission "a"). */
export async function queueAddSas(
  account: string, key: string, queue: string, start: Date, expiry: Date,
): Promise<string> {
  const [st, se] = [sasTime(start), sasTime(expiry)];
  const toSign = ["a", st, se, `/queue/${account}/${queue}`, "", "", "https", SAS_VERSION].join("\n");
  return `sv=${SAS_VERSION}&sp=a&st=${st}&se=${se}&spr=https&sig=${encodeURIComponent(await sign(toSign, key))}`;
}

/** Pass for this screen: create and delete queues and take messages off them (account SAS, queues only). */
export async function screenSas(account: string, key: string, start: Date, expiry: Date): Promise<string> {
  const [st, se] = [sasTime(start), sasTime(expiry)];
  const [sp, ss, srt] = ["dcp", "q", "co"];
  const toSign = [account, sp, ss, srt, st, se, "", "https", SAS_VERSION, "", ""].join("\n");
  return `sv=${SAS_VERSION}&ss=${ss}&srt=${srt}&sp=${sp}&st=${st}&se=${se}&spr=https&sig=${encodeURIComponent(await sign(toSign, key))}`;
}

/**
 * Opens a remote session: creates the queue, hands back the address for the QR through `onUrl`, then calls
 * `onAction` for each valid tap. Returns the function that ends the session and removes the queue.
 */
export function listenForRemote(
  code: string,
  onAction: (action: RemoteAction, args: string[]) => void,
  onOnline: (online: boolean) => void,
  onUrl: (url: string | null) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queueUrl = "";
  let pass = "";

  const poll = async () => {
    if (stopped) return;
    // One poll at a time, and none while the tab is hidden: a forgotten tab must not keep hitting the queue.
    if (!document.hidden) {
      try {
        // Taken messages stay hidden for 10 minutes and expire after one, so there is nothing to delete.
        const res = await fetch(`${queueUrl}/messages?numofmessages=32&visibilitytimeout=600&${pass}`);
        if (!res.ok) throw new Error(String(res.status));
        const xml = new DOMParser().parseFromString(await res.text(), "application/xml");
        onOnline(true);
        for (const node of xml.getElementsByTagName("MessageText")) {
          const tap = parseRemoteMessage(node.textContent ?? "");
          if (tap && !stopped) onAction(...tap);
        }
      } catch {
        onOnline(false);
      }
    }
    if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
  };

  void (async () => {
    try {
      if (!ACCOUNT || !KEY) throw new Error("remote not configured");
      const now = Date.now();
      const start = new Date(now - 5 * 60_000); // allow for clocks that disagree
      const expiry = new Date(now + PHONE_PASS_HOURS * 3_600_000);
      const queue = `skyfield-${code}`;
      queueUrl = `https://${ACCOUNT}.queue.core.windows.net/${queue}`;
      pass = await screenSas(ACCOUNT, KEY, start, expiry);
      const created = await fetch(`${queueUrl}?${pass}`, { method: "PUT" });
      if (!created.ok) throw new Error(String(created.status));
      const phonePass = await queueAddSas(ACCOUNT, KEY, queue, start, expiry);
      if (stopped) return;
      const page: string = import.meta.env.VITE_REMOTE_URL ?? `${window.location.origin}/remote.html`;
      // The whole "add a message" address rides in the fragment, so the page's host never sees it.
      onUrl(`${page}#${encodeURIComponent(`${queueUrl}/messages?messagettl=60&${phonePass}`)}`);
      void poll();
    } catch {
      onOnline(false);
    }
  })();

  return () => {
    stopped = true;
    clearTimeout(timer);
    onUrl(null);
    if (queueUrl && pass) void fetch(`${queueUrl}?${pass}`, { method: "DELETE", keepalive: true }).catch(() => {});
  };
}
