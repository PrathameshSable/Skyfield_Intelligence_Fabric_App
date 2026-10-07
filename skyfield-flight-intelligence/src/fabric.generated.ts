// AUTO-GENERATED connection config consumed by getFabricClient().
//
// Regenerate (authenticated, with your real ids in fabric.yaml) via:
//   npx fabric-app-data generate -o src/fabric.generated.ts
//
// The committed placeholder ids let the app build and run in sample mode; the
// live Fabric path uses whatever ids `generate` writes here at deploy time.
import type { FabricConfig } from "@microsoft/fabric-app-data";

export const fabricConfig: FabricConfig = {
  semanticModels: {
    flightsModel: {
      workspaceId: "00000000-0000-0000-0000-000000000000",
      itemId: "00000000-0000-0000-0000-000000000000",
    },
  },
};
