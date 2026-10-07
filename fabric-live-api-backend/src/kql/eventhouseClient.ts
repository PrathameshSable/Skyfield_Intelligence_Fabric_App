import { Client as KustoClient, KustoConnectionStringBuilder } from "azure-kusto-data";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Optional read client for the Fabric Eventhouse (KQL database).
 *
 * The Rayfin app reads its data through the Power BI semantic model (DAX), so
 * this client is NOT the app's main read path. It's here for:
 *   • a lightweight JSON read API for non-Fabric clients / debugging, and
 *   • confirming write-back landed in the Eventhouse.
 *
 * Auth uses a Microsoft Entra ID service principal (app registration).
 * Returns `null` from `getClient()` when KQL isn't configured.
 */
export class EventhouseClient {
  private client: KustoClient | null = null;

  private getClient(): KustoClient | null {
    if (!config.kustoEnabled) return null;
    if (this.client) return this.client;

    const kcsb = KustoConnectionStringBuilder.withAadApplicationKeyAuthentication(
      config.KUSTO_QUERY_URI as string,
      config.AZURE_CLIENT_ID as string,
      config.AZURE_CLIENT_SECRET as string,
      config.AZURE_TENANT_ID as string,
    );
    this.client = new KustoClient(kcsb);
    return this.client;
  }

  get enabled(): boolean {
    return config.kustoEnabled;
  }

  /**
   * Run a read-only KQL query and return rows as plain objects.
   * `query` should be a complete KQL statement (the caller builds it).
   */
  async query(query: string): Promise<Record<string, unknown>[]> {
    const client = this.getClient();
    if (!client) throw new Error("Eventhouse/KQL is not configured");

    const response = await client.execute(config.KUSTO_DATABASE as string, query);
    const primary = response.primaryResults[0];
    if (!primary) return [];

    const rows: Record<string, unknown>[] = [];
    for (const row of primary.rows()) {
      rows.push((row as { toJSON: () => Record<string, unknown> }).toJSON());
    }
    return rows;
  }

  /** Convenience: most-recent N rows from the configured events table. */
  async recentEvents(limit = 50): Promise<Record<string, unknown>[]> {
    const n = Math.max(1, Math.min(limit, 1000));
    const table = config.KUSTO_TABLE;
    return this.query(`['${table}'] | sort by ingestedAt desc | take ${n}`);
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "error closing Kusto client");
    }
  }
}
