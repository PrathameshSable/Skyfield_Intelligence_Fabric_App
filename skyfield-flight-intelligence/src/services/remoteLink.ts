// Phone remote link: the phone page (public/remote.html) posts an action name to a public relay topic and
// this screen listens on the same topic. Only a random code and the action name leave the app.
import { isRemoteAction, type RemoteAction } from "../lib/remoteKeys.js";

// shortcut: free public relay (ntfy.sh: 60 taps in a burst, then one per 5 s, 250 a day per phone);
// self-host or buy a tier if demos hit that. remote.html holds the same address and topic prefix.
const RELAY = "https://ntfy.sh";
const TOPIC_PREFIX = "skyfield-";

/** Where phones load the buttons. Must open without Fabric sign-in, which the app's own hosting does not allow. */
const REMOTE_PAGE: string = import.meta.env.VITE_REMOTE_URL ?? `${window.location.origin}/remote.html`;

/** The phone remote is offered only once a public page address is configured (always in local dev). */
export const REMOTE_ENABLED: boolean = Boolean(import.meta.env.VITE_REMOTE_URL) || import.meta.env.DEV;

const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

/** The code is all that guards the channel, so it is long and random (and never reused across page loads). */
export function newRemoteCode(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(12)),
    (b) => CODE_CHARS[b % CODE_CHARS.length],
  ).join("");
}

/** The code rides in the fragment, so the page's host never sees it. */
export function remoteUrl(code: string): string {
  return `${REMOTE_PAGE}#${code}`;
}

/** Calls `onAction` for each valid tap. Returns the function that disconnects. */
export function listenForRemote(
  code: string,
  onAction: (action: RemoteAction, args: string[]) => void,
  onOnline: (online: boolean) => void,
): () => void {
  const stream = new EventSource(`${RELAY}/${TOPIC_PREFIX}${code}/sse`);
  stream.onopen = () => onOnline(true);
  stream.onerror = () => onOnline(false); // EventSource retries on its own
  stream.onmessage = (e) => {
    try {
      // A tap is "action" or "action:arg:arg" (the feed start carries region and minutes).
      const [action, ...args] = String(JSON.parse(e.data as string).message).split(":");
      // Anyone who has the code can post, so only known action names get through; receivers validate args.
      if (isRemoteAction(action)) onAction(action, args);
    } catch {
      /* not a message for us */
    }
  };
  return () => stream.close();
}
