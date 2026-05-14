import type { AppConfig } from "./config.js";

export function assertAuthorized(config: AppConfig, accessToken: string): void {
  if (accessToken !== config.MCP_OAUTH_BEARER_TOKEN) {
    throw new Error("Unauthorized: invalid OAuth bearer token");
  }
}
