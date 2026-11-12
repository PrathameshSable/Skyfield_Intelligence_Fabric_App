// Entry for auth-popup.html: MSAL v5 needs the redirect page to pass a popup's sign-in response back to the app
// (over a BroadcastChannel). In the hidden sign-in frame the app reads the response from this page's address instead
// (services/msal.ts), and the bridge would clear that address, so it only runs outside a frame.
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

if (window.parent === window) {
  broadcastResponseToMainFrame().catch(() => {
    // opened without a sign-in response - nothing to hand back
  });
}
