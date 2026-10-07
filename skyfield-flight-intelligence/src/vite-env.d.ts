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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
