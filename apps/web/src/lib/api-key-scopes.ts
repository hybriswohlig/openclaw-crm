/**
 * Scope semantics for `oc_sk_` API keys.
 *
 * Stored as a JSON text column (`api_keys.scopes`). Enforcement is deliberately
 * fail-open for anything that is not an explicit non-write scope list, because
 * live keys (MCP connector, OpenClaw agents, WhatsApp bridge) were created
 * before scopes were checked.
 *
 * A key is read-only only when its scopes parse to a non-empty string array
 * and none of those strings is write-capable. Everything else keeps full
 * access, exactly as before this check existed:
 *
 * - missing, null, blank, or unparseable scopes
 * - a JSON value that is not an array (including a bare string)
 * - an array that contains a non-string
 * - an empty array `[]`
 * - any array that includes at least one write-capable scope
 *
 * Write-capable (case-insensitive, trimmed):
 * - `*`, or any scope that contains `*`
 * - any scope that contains the substring `write`
 *   (`write`, `readwrite`, `read-write`, `read_write`, `crm:write`, …)
 * - a scope equal to, or segmented by `: . _ -` or whitespace into,
 *   `admin`, `full`, or `all`
 *
 * Values this repo actually writes when creating a key:
 * - UI “Voller Zugriff” and the server default when `scopes` is omitted: `["*"]`
 * - UI “Nur lesen”: `["read"]`
 * - DB column default, if a row is inserted without the column: `["*"]`
 * - `POST /api/v1/api-keys` may store any string array the caller sends
 */

export const API_KEY_FULL_SCOPES = ["*"] as const;
export const API_KEY_READ_SCOPES = ["read"] as const;

const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeHttpMethod(method: string | null | undefined): boolean {
  return SAFE_HTTP_METHODS.has((method ?? "").trim().toUpperCase());
}

export function isWriteCapableScope(scope: string): boolean {
  const normalized = scope.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("*") || normalized.includes("write")) return true;
  const parts = normalized.split(/[:._\-\s]+/).filter(Boolean);
  return parts.some((part) => part === "admin" || part === "full" || part === "all");
}

/**
 * Parse a stored scopes value.
 * `null` means “not an explicit scope list” — the caller must treat that as
 * full access.
 */
export function parseApiKeyScopes(raw: unknown): string[] | null {
  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const scopes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    scopes.push(entry);
  }
  return scopes;
}

/** True only for an explicit scope list that contains no write-capable scope. */
export function isReadOnlyApiKeyScopes(raw: unknown): boolean {
  const scopes = parseApiKeyScopes(raw);
  if (!scopes || scopes.length === 0) return false;
  return !scopes.some(isWriteCapableScope);
}
