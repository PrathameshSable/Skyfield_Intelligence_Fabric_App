import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * OpenSky moved to OAuth2 **client-credentials** (basic auth is no longer
 * accepted). This caches the bearer token and refreshes it shortly before it
 * expires. Create a client at https://opensky-network.org → Account → API
 * clients to get OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET.
 */
export class OpenSkyTokenProvider {
  private token: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;

  async getToken(signal?: AbortSignal): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.expiresAt) return this.token;
    if (this.inflight) return this.inflight;

    this.inflight = this.requestToken(signal).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async requestToken(signal?: AbortSignal): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.OPENSKY_CLIENT_ID as string,
      client_secret: config.OPENSKY_CLIENT_SECRET as string,
    });

    const res = await fetch(config.OPENSKY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
    if (!res.ok) {
      throw new Error(`OpenSky token request failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = json.access_token;
    // Refresh 30s early to avoid races near expiry.
    this.expiresAt = Date.now() + Math.max(0, (json.expires_in - 30) * 1000);
    logger.debug({ expiresIn: json.expires_in }, "obtained OpenSky access token");
    return this.token;
  }
}
