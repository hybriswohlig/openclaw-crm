/**
 * Runtime configuration for the CRM MCP server.
 *
 * Auth modes (first match wins at request time):
 * 1. In-memory session from `crm_login` tool (Cookie)
 * 2. CRM_API_KEY env (Bearer oc_sk_...)
 * 3. CRM_EMAIL + CRM_PASSWORD env (auto sign-in on first request)
 */

export type AuthMode = "api_key" | "session" | "none";

export interface McpConfig {
  baseUrl: string;
  apiKey: string | null;
  email: string | null;
  password: string | null;
  /** Optional path to persist session token between process restarts */
  sessionFile: string | null;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function loadConfig(): McpConfig {
  const baseUrl = process.env.CRM_BASE_URL?.trim() || process.env.OPENCLAW_CRM_URL?.trim();
  if (!baseUrl) {
    throw new Error(
      "CRM_BASE_URL is required (e.g. https://crm.example.com or http://localhost:3001)"
    );
  }

  return {
    baseUrl: trimSlash(baseUrl),
    apiKey: process.env.CRM_API_KEY?.trim() || process.env.OPENCLAW_CRM_API_KEY?.trim() || null,
    email: process.env.CRM_EMAIL?.trim() || null,
    password: process.env.CRM_PASSWORD ?? null,
    sessionFile: process.env.CRM_SESSION_FILE?.trim() || null,
  };
}
