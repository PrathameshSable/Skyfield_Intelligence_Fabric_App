// Microsoft (Entra ID) sign-in for the one thing the app calls directly: the Fabric job API that starts and stops
// the feed notebook. The globe's data still comes through the Fabric host (semantic model), which needs no sign-in.
//
// Inside Fabric the app is a cross-origin iframe on protected static hosting, so Microsoft's sign-in page can't be
// shown and popups get "Authentication required". Sign-in is silent: a hidden iframe reuses the browser's Microsoft
// session and lands on auth-popup.html, and the app reads the response from that frame's address (same pattern as
// London Bus Live). App registration b443fe41 (shared demo SPA): its redirect URIs must include this app's
// hosting URL + /auth-popup.html.
import {
  BrowserAuthError,
  BrowserAuthErrorCodes,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";

const MSAL_CLIENT_ID = "b443fe41-6055-42cf-8792-ca8ce3446208";
const MSAL_TENANT_ID = "fb33e7e1-6a98-4d5a-bd25-f47acf95078a";
const FABRIC_SCOPES = ["https://api.fabric.microsoft.com/.default"];

/** A throttled capacity delays every request to the app's hosting (20 s each was seen on the F4). */
const SILENT_TIMEOUT_MS = 60_000;

/** Reads the silent sign-in response straight from the hidden frame's address instead of waiting for the page. */
class SilentFramePolling extends PublicClientApplication {
  protected override waitForIframeResponse(
    iframe: HTMLIFrameElement,
    request: Parameters<PublicClientApplication["waitForIframeResponse"]>[1],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.clearInterval(poll);
        reject(new BrowserAuthError(BrowserAuthErrorCodes.timedOut, request.correlationId));
      }, SILENT_TIMEOUT_MS);
      const poll = window.setInterval(() => {
        let href = "";
        try {
          href = iframe.contentWindow?.location.href ?? ""; // throws while the frame is on Microsoft's page
        } catch {
          return;
        }
        if (!href || href === "about:blank") return;
        window.clearTimeout(timeout);
        window.clearInterval(poll);
        resolve(iframe.contentWindow!.location.hash);
      }, 50);
    });
  }
}

const msal = new SilentFramePolling({
  auth: {
    clientId: MSAL_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${MSAL_TENANT_ID}`,
    redirectUri: `${window.location.origin}/auth-popup.html`,
  },
  cache: { cacheLocation: "localStorage" },
});

let init: Promise<void> | null = null;

async function cachedAccount(): Promise<AccountInfo | null> {
  init ??= msal.initialize().catch(() => {});
  await init;
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
}

function describe(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  if (/consent_required|AADSTS65001/i.test(message)) return "The app needs a one-time consent to call Fabric.";
  if (/login_required|interaction_required|AADSTS50058/i.test(message))
    return "No Microsoft session found in this browser, or third-party cookies are blocked.";
  if (/timed_out|timeout/i.test(message)) return "Microsoft sign-in did not respond in time.";
  return message.slice(0, 200);
}

/**
 * Fabric API token, signing in silently first if needed. `loginHint` (the Fabric user's UPN) picks the right
 * account when the browser has several. Throws a readable error when it can't.
 */
export async function getFabricToken(loginHint?: string): Promise<string> {
  let account = await cachedAccount();
  if (account) {
    try {
      return (await msal.acquireTokenSilent({ scopes: FABRIC_SCOPES, account })).accessToken;
    } catch {
      account = null; // cached account no longer usable - try SSO below
    }
  }
  let error = "";
  for (const hint of loginHint ? [loginHint, undefined] : [undefined]) {
    try {
      const result = await msal.ssoSilent({ scopes: FABRIC_SCOPES, ...(hint ? { loginHint: hint } : {}) });
      if (result.account) msal.setActiveAccount(result.account);
      return result.accessToken;
    } catch (err) {
      error = describe(err);
      // no answer at all - trying again without the hint would only wait another minute
      if ((err as BrowserAuthError)?.errorCode === BrowserAuthErrorCodes.timedOut) break;
    }
  }
  throw new Error(error || "Could not sign in to Microsoft.");
}
