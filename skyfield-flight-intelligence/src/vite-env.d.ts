/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Force the animated sample fleet even when embedded in the Fabric portal. */
  readonly VITE_FORCE_SAMPLE?: string;
  /** Fabric workspace ID (used by the test:fabric helper). */
  readonly VITE_FABRIC_WORKSPACE_ID?: string;
  /** Fabric/Rayfin item ID (used by the test:fabric helper). */
  readonly VITE_FABRIC_ITEM_ID?: string;
  /** Fabric portal base URL (e.g. https://app.fabric.microsoft.com/). */
  readonly VITE_FABRIC_PORTAL_URL?: string;
  /** Public address of remote.html for the phone remote (the app's own hosting needs Fabric sign-in). */
  readonly VITE_REMOTE_URL?: string;
  /** Storage account whose queues carry the phone remote's taps, and its key (secret: keep in .env.local). */
  readonly VITE_REMOTE_ACCOUNT?: string;
  readonly VITE_REMOTE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
