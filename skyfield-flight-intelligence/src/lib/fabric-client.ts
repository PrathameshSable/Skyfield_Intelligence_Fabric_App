import { SemanticModelMessageClient } from "@microsoft/fabric-app-data-embed-client";
import { FabricClient, type FabricClientConfig } from "@microsoft/fabric-app-data";
import { EmbedFabricApiProxy } from "@microsoft/fabric-app-data-proxy";
import { fabricConfig } from "@/fabric.generated";

let _client: FabricClient | undefined;
let _messageClient: SemanticModelMessageClient | undefined;

/**
 * Returns the FabricClient singleton. It talks to the Fabric host over
 * postMessage (EmbedFabricApiProxy) and resolves connection aliases from
 * fabric.generated.ts — so semantic-model queries work when the app is embedded
 * in the Fabric portal as a Rayfin item.
 */
export function getFabricClient(): FabricClient {
  if (!_messageClient) _messageClient = new SemanticModelMessageClient();
  if (!_client) {
    const proxy = new EmbedFabricApiProxy(_messageClient);
    _client = new FabricClient({ proxy, ...fabricConfig } as FabricClientConfig);
  }
  return _client;
}
