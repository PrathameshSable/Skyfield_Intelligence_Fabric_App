import { z } from "zod";

/**
 * Centralised, validated configuration. The process fails fast at startup if a
 * required variable is missing or malformed, so the rest of the code can treat
 * config as always-valid.
 */
const booleanish = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(["true", "false"]))
  .transform((v) => v === "true");

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // Ingestion source selector
  INGEST_SOURCE: z.enum(["opensky", "generic"]).default("opensky"),
  // 25s keeps OpenSky within its 4000-credit/day budget when using a 1-credit bbox.
  INGEST_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(25000),
  INGEST_POLL_ENABLED: booleanish.default("true"),

  // Generic REST API source (INGEST_SOURCE=generic)
  EXTERNAL_API_BASE_URL: z.string().url().default("https://api.example.com"),
  EXTERNAL_API_PATH: z.string().default("/"),
  EXTERNAL_API_KEY: z.string().optional(),

  // OpenSky flight source (INGEST_SOURCE=opensky)
  OPENSKY_API_BASE: z.string().url().default("https://opensky-network.org"),
  OPENSKY_TOKEN_URL: z
    .string()
    .url()
    .default(
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    ),
  OPENSKY_CLIENT_ID: z.string().optional(),
  OPENSKY_CLIENT_SECRET: z.string().optional(),
  /** Optional bounding box "lamin,lomin,lamax,lomax" to limit the query. */
  OPENSKY_BBOX: z.string().optional(),

  // Eventstream (Event Hubs compatible custom-app endpoint)
  EVENTSTREAM_CONNECTION_STRING: z.string().min(1),
  EVENTSTREAM_BATCH_MAX_SIZE: z.coerce.number().int().positive().default(100),
  EVENTSTREAM_BATCH_MAX_WAIT_MS: z.coerce.number().int().positive().default(1000),

  // Eventhouse / KQL (optional)
  KUSTO_QUERY_URI: z.string().url().optional().or(z.literal("")),
  KUSTO_DATABASE: z.string().optional(),
  KUSTO_TABLE: z.string().default("LiveEvents"),

  // Fabric Warehouse — durable, relational write-back via T-SQL (optional)
  // Server host only, e.g. "<guid>.datawarehouse.fabric.microsoft.com"
  FABRIC_WAREHOUSE_SERVER: z.string().optional(),
  FABRIC_WAREHOUSE_DATABASE: z.string().optional(),
  FABRIC_WAREHOUSE_TABLE: z.string().default("dbo.LiveEvents"),
  WAREHOUSE_BATCH_MAX_SIZE: z.coerce.number().int().positive().default(200),
  WAREHOUSE_BATCH_MAX_WAIT_MS: z.coerce.number().int().positive().default(1500),

  // Microsoft Entra service principal — shared by KQL read + Warehouse write.
  AZURE_TENANT_ID: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  AZURE_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  /** True when KQL read is fully configured. */
  kustoEnabled: boolean;
  /** True when Fabric Warehouse write-back is fully configured. */
  warehouseEnabled: boolean;
};

function load(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  const hasServicePrincipal = Boolean(
    env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET,
  );
  const kustoEnabled = Boolean(
    env.KUSTO_QUERY_URI && env.KUSTO_DATABASE && hasServicePrincipal,
  );
  const warehouseEnabled = Boolean(
    env.FABRIC_WAREHOUSE_SERVER && env.FABRIC_WAREHOUSE_DATABASE && hasServicePrincipal,
  );

  return { ...env, kustoEnabled, warehouseEnabled };
}

export const config = load();
